# Nex POS

Multi-tenant SaaS retail point of sale. Merchants run isolated stores, registers, inventory, and sales with cash, mobile money, and bank transfer payments.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind
- **Supabase** (Postgres, Auth, RLS)
- **TanStack Query** + **Zustand** (cart)

## Project structure

```
nex/
├── apps/web/           # Next.js application
├── packages/shared/    # Zod validators & shared types
└── supabase/
    └── migrations/   # Database schema, RLS, RPC functions
```

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Run migrations in order from `supabase/migrations/` (SQL Editor or CLI):

   ```bash
   supabase link --project-ref YOUR_REF
   supabase db push
   ```

3. Enable Email auth in Authentication → Providers.

### 2. Environment

Copy `.env.example` to `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### 3. Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## First-time flow

1. **Sign up** → **Onboarding** (business name, store, tax settings).
2. **Products** → add items with initial stock.
3. **POS** → select register → **Open shift** → sell → **Pay** → print receipt.
4. **Close shift** with cash count; view **Reports** and **Dashboard**.

## Staff invites

1. Owner/manager: **Team** → invite by email + role.
2. Invitee signs up with the same email.
3. Open `/invite?id=INVITE_UUID` (link from invite list) to join the organization.

## Key routes

| Route | Description |
|-------|-------------|
| `/dashboard` | Today KPIs, register shortcuts |
| `/products` | Catalog management |
| `/inventory` | Per-store stock & adjustments |
| `/pos/[registerId]` | Fullscreen cashier UI |
| `/sales` | History & voids (managers) |
| `/reports` | Payment mix, shifts, audit log |
| `/stores` | Stores & registers |
| `/team` | Staff invites |
| `/settings` | Tax, receipt settings |

## Security

- All tenant tables use **Row Level Security** scoped by `organization_id`.
- Sales, voids, and inventory changes run through **SECURITY DEFINER** RPCs with stock checks and idempotency keys.

See [docs/EXTENSIONS.md](docs/EXTENSIONS.md) for Phase 2 extension points.
