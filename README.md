# Saudidex - Saudi Arabian B2B Company Directory

Saudidex is a comprehensive B2B company directory for Saudi Arabia, featuring over 70,000+ companies with contact details, certifications, and business information. The platform includes AI-powered discovery, web crawling, and data enrichment capabilities.

## 🚀 Features

- **Company Directory**: Browse thousands of Saudi Arabian companies with detailed profiles
- **AI-Powered Discovery**: Automatic discovery and addition of new companies from various sources
- **Multi-language Support**: Full Arabic and English localization
- **Admin Dashboard**: Complete moderation and approval workflow for company profiles
- **AI Enrichment**: Automatic enhancement of company profiles with missing information
- **Search & Filtering**: Advanced search capabilities with filters for specific industries and services
- **Responsive UI**: Fully responsive design for desktop and mobile devices

## 🏗️ Architecture Overview

The system is built with a modern tech stack:

- **Frontend**: React/Vite with TypeScript
- **Backend**: Node.js/Express API server
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (Google OAuth)
- **Styling**: Tailwind CSS with shadcn/ui components
- **AI Integration**: Multiple providers (Groq, OpenAI, Mistral, HuggingFace)

## 🎯 New Features & Improvements

### Enhanced Scraping Architecture

Recent updates have significantly improved the scraping architecture:

1. **Evidence Storage**:
   - Created `source_pages`, `field_evidence`, and `company_raw_html` tables
   - All extracted data now has provenance tracking
   - Confidence scores for each extracted field

2. **Robots.txt Compliance**:
   - Implemented `robotsPolicy.ts` module
   - Automatic checking of robots.txt before crawling
   - Support for crawl-delay directives

3. **Rate Limiting**:
   - Implemented `rateLimiter.ts` module
   - Per-domain request throttling
   - Configurable delays between requests

4. **Deterministic Parsing**:
   - Created `GenericDirectoryParser.ts` for fallback parsing
   - Demoted `UniversalAIParser.ts` match score from 0.1 to 0.02
   - Deterministic extraction now attempted before AI fallback

5. **Database-backed Queue System**:
   - Replaced in-memory queue with database-backed implementation
   - Job persistence across server restarts
   - Dead letter queue for failed jobs
   - Retry logic with exponential backoff

6. **Data Validation**:
   - Added `validator.ts` for validating extracted data
   - Field-level validation for names, emails, phones, URLs
   - Data sanitization to prevent injection attacks

7. **AI_DISABLE Mode**:
   - All AI-dependent endpoints now support `AI_DISABLED=true` mode
   - Deterministic extraction used when AI is disabled
   - Graceful degradation without errors

### Key Architecture Changes

| Feature | Before | After |
|---------|--------|-------|
| Evidence Storage | ❌ Missing tables | ✅ Complete implementation |
| Robots Compliance | ❌ None | ✅ Full implementation |
| Rate Limiting | ❌ None | ✅ Per-domain limiting |
| Deterministic Parsing | ⚠️ Extractors unused | ✅ Fully integrated |
| Queue Persistence | ❌ In-memory only | ✅ Database-backed |
| AI Independence | ❌ Required for scraping | ✅ Optional fallback |

## 🛠️ Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd saudidex
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env` and fill in the required values
   - Configure your Supabase credentials
   - Add AI provider API keys if needed

4. Run the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

## 🤖 AI_DISABLE Mode

The application supports a completely AI-independent mode:

- Set `AI_DISABLED=true` in environment variables
- All scraping and parsing becomes deterministic
- Uses GenericDirectoryParser and field extractors only
- No external AI calls are made
- Perfect for local development or compliance-sensitive environments

## 🔐 Admin Access

The admin dashboard is protected with a secret token. To access it:
1. Ensure you have the admin secret configured
2. Navigate to `/admin` in your browser
3. Enter the admin secret when prompted

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.
## 🚢 Split Deployment (Vercel + Render)

This repository can be deployed in a split architecture:

- **Vercel**: public frontend pages **and admin dashboard UI**
- **Render**: backend API plus scraping/enrichment worker workloads

### Recommended setup

1. **Deploy Render first**
   - Run the Node server (`server.ts`) on Render using the existing `render.yaml` service.
   - Configure all server-side environment variables there (Supabase service role key, AI provider keys, scheduler/job secrets).

2. **Deploy Vercel for frontend + admin UI**
   - Keep Vercel building the Vite app (`npm run build`, output `dist`).
   - Serve `/admin` and `/research` from the same Vercel SPA (no cross-origin dashboard redirect).

3. **Point dashboard API traffic to Render**
   - Set `VITE_API_BASE_URL` on Vercel to your Render API base (example: `https://saudidex.onrender.com/api`).
   - Keep auth/session handling in the frontend, and execute scraping/enrichment only in Render services.

4. **Run background jobs on Render worker(s)**
   - Use the optional `saudidex-queue-worker` service in `render.yaml` (`pnpm run worker:queue`) for queue processing.
   - Keep the Render web service for admin API endpoints and webhook/trigger handling.

5. **DNS suggestion (optional)**
   - `www.saudidex.sa` / `saudidex.sa` -> Vercel
   - `api.saudidex.sa` -> Render web service (mapped to `/api`)

This model keeps frontend/admin UI online via Vercel while isolating scraping/enrichment execution to Render.

### Best-practice audit checklist (Vercel admin UI + Render jobs)

- Set `VITE_API_BASE_URL` on Vercel to a dedicated Render API domain (for example `https://api.saudidex.sa/api`) instead of relying on implicit same-origin APIs.
- Serve `/env.js` on Vercel from the Render backend (`https://saudidex.onrender.com/env.js`) so Supabase/OAuth runtime env keys stay consistent for admin login on both platforms.
- Keep service-role secrets and AI provider keys only on Render; never expose them to Vercel/browser runtime env.
- Restrict CORS on Render to your Vercel production domain(s) and preview domain policy.
- Keep all long-running scraping/enrichment work in worker processes; admin UI requests should enqueue jobs and poll status.
- Use an always-on Render plan for worker services if you need continuous processing windows.
- Keep admin access protected with Supabase auth + server-side token verification (already used by admin API middleware).

### 24/7 frontend with Render-only background processing

Yes — this is possible:

- **Frontend uptime**: Vercel-hosted public pages remain online 24/7.
- **Backend workloads**: run scraping/enrichment as dedicated Render worker(s) (`pnpm run worker:queue`).
- **Operational note**: if Render web/worker instances are on a sleeping tier, jobs can pause until wake-up. For continuous scraping, use an always-on Render plan for the worker service.

The included `render.yaml` now defines both a web service (`saudidex-backend`) and an optional queue worker (`saudidex-queue-worker`) so scraping/enrichment can run independently from frontend traffic.
