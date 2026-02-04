use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("EKgXT2ZBGRnCiApWJP6AQ8tP7aBumKA6k3512guLGfwH");

#[program]
pub mod outcome_market {
    use super::*;

    pub fn create_intent(
        ctx: Context<CreateIntent>,
        intent_seed: u64,
        min_amount_out: u64,
        reward_amount: u64,
        ttl_submit: i64,
        ttl_accept: i64,
        fee_bps_on_accept: u16,
        fixed_fee_on_expire: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < ttl_submit && ttl_submit < ttl_accept,
            ErrorCode::InvalidTtl
        );
        require!(
            reward_amount > 0 && min_amount_out > 0,
            ErrorCode::InvalidAmount
        );

        let intent = &mut ctx.accounts.intent;
        intent.intent_seed = intent_seed;
        #[cfg(not(feature = "idl-build"))]
        {
            intent.intent_bump = ctx.bumps.intent;
        }
        #[cfg(feature = "idl-build")]
        {
            intent.intent_bump = 0;
        }
        intent.state = IntentState::Open as u8;
        intent.token_out = ctx.accounts.token_out.key();
        intent.min_amount_out = min_amount_out;
        intent.reward_token = ctx.accounts.reward_token.key();
        intent.reward_amount = reward_amount;
        intent.payer = ctx.accounts.payer.key();
        intent.initiator = ctx.accounts.initiator.key();
        intent.verifier = ctx.accounts.verifier.key();
        intent.winner = Pubkey::default();
        intent.winner_amount_out = 0;
        intent.bond_amount = 0;
        intent.ttl_submit = ttl_submit;
        intent.ttl_accept = ttl_accept;
        intent.fee_bps_on_accept = fee_bps_on_accept;
        intent.fixed_fee_on_expire = fixed_fee_on_expire;
        intent.fee_recipient = ctx.accounts.fee_recipient.key();

        let cpi = Transfer {
            from: ctx.accounts.payer_reward_ata.to_account_info(),
            to: ctx.accounts.reward_escrow.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi),
            reward_amount,
        )?;

        emit!(IntentCreated {
            intent: intent.key(),
            payer: intent.payer,
            initiator: intent.initiator
        });
        Ok(())
    }

    pub fn select_winner(
        ctx: Context<SelectWinner>,
        solver: Pubkey,
        amount_out: u64,
        bond_min: u64,
        bond_bps_of_reward: u16,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let intent = &mut ctx.accounts.intent;
        require!(
            ctx.accounts.verifier.key() == intent.verifier,
            ErrorCode::Unauthorized
        );
        require!(
            intent.state == IntentState::Open as u8,
            ErrorCode::InvalidState
        );
        require!(now <= intent.ttl_submit, ErrorCode::TtlPassed);
        require!(amount_out > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.solver.key() == solver, ErrorCode::Unauthorized);

        let bond_from_bps = (intent.reward_amount as u128)
            .saturating_mul(bond_bps_of_reward as u128)
            .saturating_div(10_000) as u64;
        let bond_amount = bond_min.max(bond_from_bps);

        if bond_amount > 0 {
            let cpi = Transfer {
                from: ctx.accounts.solver_reward_ata.to_account_info(),
                to: ctx.accounts.bond_escrow.to_account_info(),
                authority: ctx.accounts.solver.to_account_info(),
            };
            token::transfer(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi),
                bond_amount,
            )?;
        }

        intent.winner = solver;
        intent.winner_amount_out = amount_out;
        intent.bond_amount = bond_amount;
        intent.state = IntentState::Selected as u8;

        emit!(WinnerSelected {
            intent: intent.key(),
            solver,
            amount_out,
            bond_amount
        });
        Ok(())
    }

    pub fn fulfill(mut ctx: Context<Fulfill>, amount_out: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let intent_state = ctx.accounts.intent.state;
        let winner = ctx.accounts.intent.winner;
        let min_amount_out = ctx.accounts.intent.min_amount_out;
        let winner_amount_out = ctx.accounts.intent.winner_amount_out;
        let ttl_accept = ctx.accounts.intent.ttl_accept;
        require!(
            intent_state == IntentState::Selected as u8,
            ErrorCode::InvalidState
        );
        require!(ctx.accounts.winner.key() == winner, ErrorCode::Unauthorized);
        require!(now <= ttl_accept, ErrorCode::TtlPassed);
        require!(amount_out >= min_amount_out, ErrorCode::InvalidAmount);
        require!(amount_out >= winner_amount_out, ErrorCode::InvalidAmount);

        let cpi = Transfer {
            from: ctx.accounts.winner_token_out_ata.to_account_info(),
            to: ctx.accounts.initiator_token_out_ata.to_account_info(),
            authority: ctx.accounts.winner.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi),
            amount_out,
        )?;

        ctx.accounts.intent.state = IntentState::Fulfilled as u8;
        emit!(Fulfilled {
            intent: ctx.accounts.intent.key(),
            solver: winner,
            amount_out
        });

        accept_inner(&mut ctx, amount_out)
    }

    pub fn expire(mut ctx: Context<Expire>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let state = ctx.accounts.intent.state;

        if state == IntentState::Open as u8 {
            let ttl_submit = ctx.accounts.intent.ttl_submit;
            let reward_amount = ctx.accounts.intent.reward_amount;
            let fixed_fee_on_expire = ctx.accounts.intent.fixed_fee_on_expire;
            require!(now > ttl_submit, ErrorCode::TtlNotReached);
            let fee = fixed_fee_on_expire.min(reward_amount);
            let refund = reward_amount.saturating_sub(fee);
            transfer_reward(&ctx, refund, fee)?;
            ctx.accounts.intent.state = IntentState::Expired as u8;
            emit!(Expired {
                intent: ctx.accounts.intent.key(),
                state: ctx.accounts.intent.state
            });
            return Ok(());
        }

        if state == IntentState::Selected as u8 {
            let ttl_accept = ctx.accounts.intent.ttl_accept;
            let reward_amount = ctx.accounts.intent.reward_amount;
            let fixed_fee_on_expire = ctx.accounts.intent.fixed_fee_on_expire;
            let bond_amount = ctx.accounts.intent.bond_amount;
            let intent_seed = ctx.accounts.intent.intent_seed;
            let intent_bump = ctx.accounts.intent.intent_bump;
            let payer = ctx.accounts.intent.payer;
            let initiator = ctx.accounts.intent.initiator;
            let winner = ctx.accounts.intent.winner;
            require!(now > ttl_accept, ErrorCode::TtlNotReached);
            let fee = fixed_fee_on_expire.min(reward_amount);
            let refund = reward_amount.saturating_sub(fee);
            transfer_reward(&ctx, refund, fee)?;

            if bond_amount > 0 {
                let seed_bytes = intent_seed.to_le_bytes();
                let signer: &[&[u8]] = &[
                    b"intent",
                    payer.as_ref(),
                    initiator.as_ref(),
                    &seed_bytes,
                    &[intent_bump],
                ];
                let cpi = Transfer {
                    from: ctx.accounts.bond_escrow.to_account_info(),
                    to: ctx.accounts.fee_recipient_reward_ata.to_account_info(),
                    authority: ctx.accounts.intent.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi,
                        &[signer],
                    ),
                    bond_amount,
                )?;
            }

            update_reputation_expire(&mut ctx, winner, -1)?;
            ctx.accounts.intent.state = IntentState::Expired as u8;
            emit!(Expired {
                intent: ctx.accounts.intent.key(),
                state: ctx.accounts.intent.state
            });
            return Ok(());
        }

        Err(error!(ErrorCode::InvalidState))
    }
}

fn accept_inner(ctx: &mut Context<Fulfill>, amount_out: u64) -> Result<()> {
    let intent_state = ctx.accounts.intent.state;
    let reward_amount = ctx.accounts.intent.reward_amount;
    let fee_bps = ctx.accounts.intent.fee_bps_on_accept;
    let intent_seed = ctx.accounts.intent.intent_seed;
    let intent_bump = ctx.accounts.intent.intent_bump;
    let payer = ctx.accounts.intent.payer;
    let initiator = ctx.accounts.intent.initiator;
    let bond_amount = ctx.accounts.intent.bond_amount;
    let winner = ctx.accounts.intent.winner;
    require!(
        intent_state == IntentState::Fulfilled as u8,
        ErrorCode::InvalidState
    );

    let fee = (reward_amount as u128)
        .saturating_mul(fee_bps as u128)
        .saturating_div(10_000) as u64;
    let payout = reward_amount.saturating_sub(fee);

    let seed_bytes = intent_seed.to_le_bytes();
    let signer: &[&[u8]] = &[
        b"intent",
        payer.as_ref(),
        initiator.as_ref(),
        &seed_bytes,
        &[intent_bump],
    ];

    let pay_cpi = Transfer {
        from: ctx.accounts.reward_escrow.to_account_info(),
        to: ctx.accounts.winner_reward_ata.to_account_info(),
        authority: ctx.accounts.intent.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            pay_cpi,
            &[signer],
        ),
        payout,
    )?;

    if fee > 0 {
        let fee_cpi = Transfer {
            from: ctx.accounts.reward_escrow.to_account_info(),
            to: ctx.accounts.fee_recipient_reward_ata.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                fee_cpi,
                &[signer],
            ),
            fee,
        )?;
    }

    if bond_amount > 0 {
        let bond_cpi = Transfer {
            from: ctx.accounts.bond_escrow.to_account_info(),
            to: ctx.accounts.winner_reward_ata.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                bond_cpi,
                &[signer],
            ),
            bond_amount,
        )?;
    }

    update_reputation_fulfill(ctx, winner, 1)?;
    ctx.accounts.intent.state = IntentState::Accepted as u8;

    emit!(Accepted {
        intent: ctx.accounts.intent.key(),
        solver: winner,
        amount_out
    });
    Ok(())
}

fn transfer_reward(ctx: &Context<Expire>, refund: u64, fee: u64) -> Result<()> {
    let intent = &ctx.accounts.intent;
    let seed_bytes = intent.intent_seed.to_le_bytes();
    let signer: &[&[u8]] = &[
        b"intent",
        intent.payer.as_ref(),
        intent.initiator.as_ref(),
        &seed_bytes,
        &[intent.intent_bump],
    ];

    if refund > 0 {
        let cpi = Transfer {
            from: ctx.accounts.reward_escrow.to_account_info(),
            to: ctx.accounts.payer_reward_ata.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi,
                &[signer],
            ),
            refund,
        )?;
    }

    if fee > 0 {
        let cpi = Transfer {
            from: ctx.accounts.reward_escrow.to_account_info(),
            to: ctx.accounts.fee_recipient_reward_ata.to_account_info(),
            authority: ctx.accounts.intent.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi,
                &[signer],
            ),
            fee,
        )?;
    }

    Ok(())
}

fn update_reputation_fulfill(ctx: &mut Context<Fulfill>, solver: Pubkey, delta: i64) -> Result<()> {
    let rep = &mut ctx.accounts.reputation;
    if rep.solver == Pubkey::default() {
        rep.solver = solver;
    }
    rep.score = rep.score.saturating_add(delta);
    rep.last_updated = Clock::get()?.unix_timestamp;
    emit!(ReputationUpdated {
        solver: rep.solver,
        delta
    });
    Ok(())
}

fn update_reputation_expire(ctx: &mut Context<Expire>, solver: Pubkey, delta: i64) -> Result<()> {
    let rep = &mut ctx.accounts.reputation;
    if rep.solver == Pubkey::default() {
        rep.solver = solver;
    }
    rep.score = rep.score.saturating_add(delta);
    rep.last_updated = Clock::get()?.unix_timestamp;
    emit!(ReputationUpdated {
        solver: rep.solver,
        delta
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(intent_seed: u64)]
pub struct CreateIntent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: initiator can be any pubkey
    pub initiator: UncheckedAccount<'info>,
    /// CHECK: verifier can be any pubkey
    pub verifier: UncheckedAccount<'info>,
    /// CHECK: fee recipient can be any pubkey
    pub fee_recipient: UncheckedAccount<'info>,
    pub token_out: Account<'info, Mint>,
    pub reward_token: Account<'info, Mint>,

    #[cfg_attr(
        not(feature = "idl-build"),
        account(
            init,
            payer = payer,
            space = 8 + Intent::SIZE,
            seeds = [
                b"intent",
                payer.key().as_ref(),
                initiator.key().as_ref(),
                &intent_seed.to_le_bytes()
            ],
            bump
        )
    )]
    #[cfg_attr(
        feature = "idl-build",
        account(
            init,
            payer = payer,
            space = 8 + Intent::SIZE
        )
    )]
    pub intent: Account<'info, Intent>,

    #[cfg_attr(
        not(feature = "idl-build"),
        account(
            init,
            payer = payer,
            token::mint = reward_token,
            token::authority = intent,
            seeds = [b"reward_escrow", intent.key().as_ref()],
            bump
        )
    )]
    #[cfg_attr(
        feature = "idl-build",
        account(
            init,
            payer = payer,
            token::mint = reward_token,
            token::authority = intent
        )
    )]
    pub reward_escrow: Account<'info, TokenAccount>,

    #[cfg_attr(
        not(feature = "idl-build"),
        account(
            init,
            payer = payer,
            token::mint = reward_token,
            token::authority = intent,
            seeds = [b"bond_escrow", intent.key().as_ref()],
            bump
        )
    )]
    #[cfg_attr(
        feature = "idl-build",
        account(
            init,
            payer = payer,
            token::mint = reward_token,
            token::authority = intent
        )
    )]
    pub bond_escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer_reward_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SelectWinner<'info> {
    #[account(mut)]
    pub verifier: Signer<'info>,
    /// CHECK: solver is a signer, passed separately
    pub solver: Signer<'info>,

    #[account(mut, has_one = reward_token)]
    pub intent: Account<'info, Intent>,
    pub reward_token: Account<'info, Mint>,

    #[account(mut)]
    pub solver_reward_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub bond_escrow: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Fulfill<'info> {
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(mut, has_one = token_out, has_one = reward_token)]
    pub intent: Account<'info, Intent>,
    pub token_out: Account<'info, Mint>,
    pub reward_token: Account<'info, Mint>,

    #[account(mut)]
    pub winner_token_out_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initiator_token_out_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub reward_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub bond_escrow: Account<'info, TokenAccount>,

    #[cfg_attr(
        not(feature = "idl-build"),
        account(
            init_if_needed,
            payer = winner,
            space = 8 + Reputation::SIZE,
            seeds = [b"rep", winner.key().as_ref()],
            bump
        )
    )]
    #[cfg_attr(
        feature = "idl-build",
        account(
            init_if_needed,
            payer = winner,
            space = 8 + Reputation::SIZE
        )
    )]
    pub reputation: Account<'info, Reputation>,

    #[account(mut)]
    pub winner_reward_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub fee_recipient_reward_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Expire<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut, has_one = reward_token)]
    pub intent: Account<'info, Intent>,
    pub reward_token: Account<'info, Mint>,

    #[account(mut)]
    pub reward_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub bond_escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer_reward_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub fee_recipient_reward_ata: Account<'info, TokenAccount>,

    #[cfg_attr(
        not(feature = "idl-build"),
        account(
            init_if_needed,
            payer = caller,
            space = 8 + Reputation::SIZE,
            seeds = [b"rep", intent.winner.as_ref()],
            bump
        )
    )]
    #[cfg_attr(
        feature = "idl-build",
        account(
            init_if_needed,
            payer = caller,
            space = 8 + Reputation::SIZE
        )
    )]
    pub reputation: Account<'info, Reputation>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
pub struct Intent {
    pub intent_seed: u64,
    pub intent_bump: u8,
    pub state: u8,
    pub token_out: Pubkey,
    pub min_amount_out: u64,
    pub reward_token: Pubkey,
    pub reward_amount: u64,
    pub payer: Pubkey,
    pub initiator: Pubkey,
    pub verifier: Pubkey,
    pub winner: Pubkey,
    pub winner_amount_out: u64,
    pub bond_amount: u64,
    pub ttl_submit: i64,
    pub ttl_accept: i64,
    pub fee_bps_on_accept: u16,
    pub fixed_fee_on_expire: u64,
    pub fee_recipient: Pubkey,
}

impl Intent {
    pub const SIZE: usize =
        8 + 1 + 1 + 32 + 8 + 32 + 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 2 + 8 + 32;
}

#[account]
pub struct Reputation {
    pub solver: Pubkey,
    pub score: i64,
    pub last_updated: i64,
}

impl Reputation {
    pub const SIZE: usize = 32 + 8 + 8;
}

#[event]
pub struct IntentCreated {
    pub intent: Pubkey,
    pub payer: Pubkey,
    pub initiator: Pubkey,
}

#[event]
pub struct WinnerSelected {
    pub intent: Pubkey,
    pub solver: Pubkey,
    pub amount_out: u64,
    pub bond_amount: u64,
}

#[event]
pub struct Fulfilled {
    pub intent: Pubkey,
    pub solver: Pubkey,
    pub amount_out: u64,
}

#[event]
pub struct Accepted {
    pub intent: Pubkey,
    pub solver: Pubkey,
    pub amount_out: u64,
}

#[event]
pub struct Expired {
    pub intent: Pubkey,
    pub state: u8,
}

#[event]
pub struct ReputationUpdated {
    pub solver: Pubkey,
    pub delta: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum IntentState {
    Open = 1,
    Selected = 2,
    Fulfilled = 3,
    Accepted = 4,
    Expired = 5,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid TTL")]
    InvalidTtl,
    #[msg("TTL passed")]
    TtlPassed,
    #[msg("TTL not reached")]
    TtlNotReached,
    #[msg("Invalid state")]
    InvalidState,
    #[msg("Unauthorized")]
    Unauthorized,
}
