create extension if not exists pgcrypto;

create table if not exists public.api_keys (
    id uuid primary key default gen_random_uuid(),
    name text not null default 'Unnamed',
    key_hash text not null unique,
    key_preview text not null default '',
    active boolean not null default true,
    balance numeric(18,6) not null default 0,
    currency text not null default 'token',
    allowed_models text[] not null default '{}',
    expires_at timestamptz,
    default_multiplier_enabled boolean not null default false,
    request_count bigint not null default 0,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
);

alter table public.api_keys add column if not exists balance numeric(18,6) not null default 0;
alter table public.api_keys add column if not exists currency text not null default 'token';
alter table public.api_keys add column if not exists allowed_models text[] not null default '{}';
alter table public.api_keys add column if not exists expires_at timestamptz;
alter table public.api_keys add column if not exists default_multiplier_enabled boolean not null default false;
alter table public.api_keys add column if not exists key_preview text not null default '';

-- NovaProxy uses token balance only. Normalize any old currency values.
update public.api_keys set currency = 'token' where currency is distinct from 'token';
alter table public.api_keys alter column currency set default 'token';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'api_keys_currency_token_check'
      and conrelid = 'public.api_keys'::regclass
  ) then
    alter table public.api_keys
      add constraint api_keys_currency_token_check check (currency = 'token');
  end if;
end $$;

create index if not exists api_keys_key_hash_idx on public.api_keys(key_hash);
create index if not exists api_keys_created_at_idx on public.api_keys(created_at desc);

alter table public.api_keys enable row level security;
-- The server uses the Supabase service/secret key; no public client policies are required.

-- Atomically subtract actual usage from the key balance.
create or replace function public.consume_api_key_tokens(p_key_id uuid, p_tokens bigint)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if p_tokens is null or p_tokens <= 0 then
    raise exception 'Token amount must be a positive integer';
  end if;

  update public.api_keys
  set balance = balance - p_tokens
  where id = p_key_id
  returning balance into new_balance;

  if not found then
    raise exception 'API key not found';
  end if;

  return new_balance;
end;
$$;

revoke all on function public.consume_api_key_tokens(uuid, bigint) from public;
grant execute on function public.consume_api_key_tokens(uuid, bigint) to service_role;
