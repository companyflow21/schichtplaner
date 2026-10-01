<p align="center">
  <h1 align="center">Schichtplaner</h1>
  <p align="center">
    Open-source shift planning software with AI assistance
    <br />
    <em>Self-Hosted &middot; Real-Time Collaboration &middot; AI-Powered Optimization</em>
  </p>
  <p align="center">
    <a href="https://github.com/lennystepn-hue/schichtplaner/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
    </a>
    <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma" alt="Prisma" />
    <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" alt="Docker" />
  </p>
</p>

---

**Schichtplaner** (German for "shift planner") is a fully-featured, self-hosted solution for shift scheduling and workforce management. Built with a modern tech stack, it covers everything from shift planning and time tracking to AI-powered schedule optimization — with no dependency on external SaaS services.

> **Note:** The application UI is in German. Internationalization (i18n) support is planned for future releases.

## Features

### Shift Planning

- **Flexible weekly schedules** — create shifts with division assignments
- **4 schedule views** — Flexible, Classic, Employee-centric, Monthly overview
- **Live sessions** — real-time shift booking via Socket.IO with deadline controls
- **Wish plans (Mod-Requests)** — employees can submit shift preferences
- **PDF export** ("Als PDF exportieren") — A4 landscape schedule for any period up to 62 days (week, month or custom), filterable by customer, location and employee; rows per day with night shifts, open places highlighted, header on every page. Contains only what the user may see in the plan (no contact data) and is generated locally in the browser, nothing is uploaded
- **Briefings** — weekly briefings per schedule

### Employee Management

- **Role system** — Owner > Admin > Manager > Employee
- **Divisions** — color-coded divisions with member assignment
- **Activation links** — secure invitation via token
- **Target hours** — individual weekly hour goals per employee
- **Notes** — internal employee notes (manager+ only)

### Time Tracking

- **3 tracking modes** — Manual (from/to), Stopwatch (live tracking), Manual duration
- **Categories** — configurable time categories per organization
- **Warnings** — automatic alerts when exceeding maximum hours
- **Access control** — enable time tracking for all or selected employees

### Absence Management

- **Categories** — vacation, sick leave, and custom categories
- **Approval workflow** — Pending → Approved / Declined
- **Holidays** — holiday management with regional support (German federal states)

### Reporting

- **Monthly reports** — working hours per employee at a glance
- **Target/actual comparison** — automatic comparison with target hours
- **CSV export** — hours per employee and month as CSV (opens directly in Excel)

### Internal Portal

- **Messaging** — internal messaging with reply threads
- **File management** — folder structure with upload (S3/MinIO)
- **Discussion forum** — topics with posts for cross-team communication

### AI Features (optional)

> Requires an [Anthropic API key](https://console.anthropic.com/). All AI features are feature-gated and can be disabled per organization.

- **Auto-Planner** — AI-powered schedule suggestions based on availability
- **Anomaly detection** — automatic detection of unusual patterns
- **Smart Briefing** — AI-generated weekly summaries
- **Forecasting** — demand predictions based on historical data
- **Chat** — AI assistant for planning questions

### Additional Features

- **Multi-tenancy** — multiple organizations on a single instance
- **Dark mode** — theme switching
- **Real-time updates** — Socket.IO for live changes
- **Responsive** — fully mobile-optimized
- **German UI** — complete German user interface

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS 4, shadcn/ui, Radix UI |
| Language | TypeScript 5 |
| Database | PostgreSQL 16, Prisma 7 ORM |
| Auth | NextAuth.js v5 (JWT, Credentials) |
| Real-time | Socket.IO |
| AI | Anthropic SDK (Claude) |
| State | Zustand + React Query |
| File Storage | MinIO / S3-compatible |
| Caching | Redis |
| Deployment | Docker + Caddy (Auto-HTTPS) |

## Database Schema

The complete schema contains **23 models**. Here's an overview of the core relationships:

```mermaid
erDiagram
    User ||--o{ OrganizationMember : "member of"
    User ||--o{ Booking : "books"
    User ||--o{ TimeRecord : "tracks"
    User ||--o{ Absence : "requests"

    Organization ||--o{ OrganizationMember : "has"
    Organization ||--o{ Division : "divisions"
    Organization ||--o{ Schedule : "schedules"
    Organization ||--o{ Branch : "branches"
    Organization ||--|| OrgSettings : "AI settings"

    Schedule ||--o{ Shift : "shifts"
    Schedule ||--o| LiveSession : "live"

    Shift ||--o{ Booking : "bookings"
    Shift }o--o| Division : "division"

    Division ||--o{ DivisionMember : "members"

    LiveSession ||--o{ LiveDay : "days"
    LiveSession ||--o{ LiveLog : "logs"

    Message }o--o| Message : "reply to"
    Message ||--o{ MessageRecipient : "recipients"

    Topic ||--o{ TopicPost : "posts"

    User {
        string email UK
        string firstName
        string lastName
        string locale
    }

    Organization {
        string name
        enum nameFormat
        enum scheduleVisibility
    }

    OrganizationMember {
        enum role "OWNER|ADMIN|MANAGER|EMPLOYEE"
        boolean isActive
        float targetHoursPerWeek
    }

    Schedule {
        int weekNumber
        int year
        boolean isPublic
    }

    Shift {
        int dayOfWeek
        string shiftFrom
        string shiftTo
        int maxEmployees
    }

    Booking {
        datetime bookedAt
    }

    TimeRecord {
        date date
        string timeFrom
        string timeTo
        enum type "MANUAL|WATCH|DURATION"
    }

    Absence {
        date dateFrom
        date dateTo
        enum status "PENDING|APPROVED|DECLINED"
    }

    OrgSettings {
        boolean aiEnabled
        boolean aiAutoPlanner
        boolean aiChatEnabled
        boolean aiForecast
    }
```

> See the full ER diagram with all 23 models at [`docs/db-schema.md`](docs/db-schema.md).

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Docker](https://www.docker.com/) & Docker Compose
- (Optional) [Anthropic API key](https://console.anthropic.com/) for AI features

### 1. Clone the repository

```bash
git clone https://github.com/lennystepn-hue/schichtplaner.git
cd schichtplaner
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit the `.env` file:

```env
DATABASE_URL="postgresql://schichtplaner:schichtplaner@localhost:5432/schichtplaner"
NEXTAUTH_SECRET="your-secret-key"             # openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"
ANTHROPIC_API_KEY="sk-ant-..."                # Optional, for AI features
REDIS_URL="redis://localhost:6379"
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="schichtplaner"
APP_URL="http://localhost:3000"
```

### 3. Start services (PostgreSQL, Redis, MinIO)

```bash
docker compose up -d postgres redis minio
```

### 4. Install dependencies & set up database

```bash
npm install
npx prisma migrate dev
npx prisma db seed
```

### 5. Start the development server

```bash
# Terminal 1: Next.js
npm run dev

# Terminal 2: Socket.IO server (for real-time features)
npm run dev:server
```

Open [http://localhost:3000](http://localhost:3000).

**Demo login:**
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@demo.de` | `password123` |

## Docker Deployment (Production)

For a full production setup with automatic HTTPS:

```bash
# Configure production environment
cp .env.production.example .env

# Start all services
docker compose up -d
```

The `docker-compose.yml` automatically starts:
- **PostgreSQL 16** — database
- **Redis 7** — caching
- **MinIO** — file storage (S3-compatible)
- **Next.js App** — application (port 3000)
- **Caddy** — reverse proxy with auto-HTTPS (Let's Encrypt)

## Project Structure

```
schichtplaner/
├── prisma/
│   ├── schema.prisma         # Database schema (23 models)
│   └── seed.ts               # Demo data
├── src/
│   ├── app/
│   │   ├── (auth)/           # Login, registration, activation
│   │   ├── (dashboard)/      # All protected pages
│   │   │   ├── schedule/     # Shift planning (4 views)
│   │   │   ├── employees/    # Employee management
│   │   │   ├── divisions/    # Divisions
│   │   │   ├── time/         # Time tracking
│   │   │   ├── reporting/    # Reports
│   │   │   ├── portal/       # Messages, files, forum
│   │   │   ├── ai/           # AI chat & insights
│   │   │   └── settings/     # Settings
│   │   └── api/              # REST API (50+ endpoints)
│   ├── components/
│   │   ├── ui/               # shadcn/ui primitives
│   │   ├── schedule/         # Schedule components
│   │   ├── layout/           # Sidebar, navigation
│   │   └── ...               # Feature-specific components
│   └── lib/
│       ├── auth.ts           # NextAuth configuration
│       ├── db.ts             # Prisma singleton
│       ├── ai/               # Claude AI integration
│       ├── hooks/            # Custom React hooks
│       └── socket.ts         # Socket.IO client
├── server.ts                 # Socket.IO server
├── docker-compose.yml        # Docker orchestration
├── Dockerfile                # Multi-stage production build
└── Caddyfile                 # Reverse proxy config
```

## Scripts

```bash
npm run dev              # Next.js dev server
npm run build            # Production build
npm run lint             # ESLint
npm run dev:server       # Socket.IO server (watch mode)
npx prisma migrate dev   # Database migrations
npx prisma generate      # Regenerate Prisma client
npx prisma db seed       # Load demo data
npx tsc --noEmit         # TypeScript type check
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our workflow.

## License

This project is licensed under the [MIT License](LICENSE).

---

<p align="center">
  Built with Next.js, React, Prisma, and lots of coffee.
</p>
