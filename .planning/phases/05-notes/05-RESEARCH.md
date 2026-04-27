# Phase 5: Notes - Research

**Researched:** 2026-04-27
**Domain:** Notes data layer, drag-and-drop reordering, PDF generation, text-selection UI
**Confidence:** HIGH (core stack), MEDIUM (dnd-kit v2 migration status), HIGH (PDF generation)

## Summary

Phase 5 builds on an existing `listening.notes` table that was scaffolded in Phase 1 but never wired up.  The table schema and RLS policies were written for a "public/private toggle" design — which CONTEXT.md has since overridden.  The first task of Phase 5 must therefore issue a migration that aligns the table with the all-private decision: drop `is_private`, add `updated_at` and `is_edited` columns, add `rebuttal_order` for speaker checklist ordering, and replace the RLS policies with owner-only read/write.

The three functional areas of Phase 5 map to three distinct library problems: (1) note CRUD follows the established `pool.query()` + SECURITY DEFINER RPC pattern already used in Phases 2 and 4; (2) drag-to-reorder the rebuttal checklist uses `@dnd-kit/core` + `@dnd-kit/sortable`; (3) PDF export uses `@react-pdf/renderer` v4, which is on Next.js 15's built-in `serverExternalPackages` allowlist and requires no extra config.

All note mutations must go through API route handlers (not PostgREST/Supabase client directly) because the `listening` schema is non-public.  The auth pattern is: extract Bearer token from `Authorization` header → `verifyToken()` from `lib/auth/jwks.ts` → get `userId` → enforce ownership in SQL `WHERE user_id = $1`.

**Primary recommendation:** Use `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` for rebuttal checklist drag-to-reorder; use `@react-pdf/renderer@4.5.1` with `renderToBuffer()` in a Node.js route handler for PDF export.

---

## Standard Stack

### Core (new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | 6.3.1 | Drag-and-drop context, sensors | Stable production API, keyboard accessible, React 19 compatible |
| `@dnd-kit/sortable` | 10.0.0 | Sortable preset: `SortableContext`, `useSortable`, `arrayMove` | Official preset for list reordering atop dnd-kit/core |
| `@dnd-kit/utilities` | 3.2.2 | `CSS.Transform.toString()` utility | Required companion for dnd-kit/sortable transform CSS |
| `@react-pdf/renderer` | 4.5.1 | Server-side PDF generation via React JSX | Auto-opted out of Next.js 15 bundling; supports React 19 since v4.1.0 |

### Already Installed (no new install needed)

| Library | Version | Purpose |
|---------|---------|---------|
| `zustand` | 4.5.7 | Client-side notes state store (same pattern as `debateStore`) |
| `zod` | 4.3.6 | API body validation in note CRUD routes |
| `@supabase/supabase-js` | 2.104.0 | Supabase Realtime for live note sync (same channel pattern as `useTranscriptSync`) |
| `pg` | 8.20.0 | `pool.query()` for all `listening` schema writes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@dnd-kit/core` | `@hello-pangea/dnd` | hello-pangea has simpler API but fewer escape hatches; dnd-kit is used by existing ecosystem and has better pointer + keyboard support for embedded panel UIs |
| `@dnd-kit/core` | `@dnd-kit/react` (v0.4.0) | New `@dnd-kit/react` is pre-stable (0.x); maintainers haven't confirmed production readiness; use legacy stable `@dnd-kit/core` until 1.0 |
| `@react-pdf/renderer` | `jsPDF` | jsPDF requires browser DOM; server-side use is fragile. `@react-pdf/renderer` has native Node.js `renderToBuffer()` |
| `@react-pdf/renderer` | `pdfmake` | pdfmake has known Next.js route handler crashes (GitHub issue #2429, unresolved). `@react-pdf/renderer` is on Next.js's official allowlist |
| Server-side PDF | Client-side with `jsPDF` + `html2canvas` | Screenshot-based PDF has rendering inconsistency, font problems, and poor accessibility |

**Installation:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @react-pdf/renderer
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── api/
│   └── debates/[debateId]/
│       └── notes/
│           ├── route.ts              # GET (list), POST (create)
│           └── [noteId]/
│               ├── route.ts          # PUT (edit), DELETE
│               └── reorder/
│                   └── route.ts      # PUT (update rebuttal_order)
│       └── notes/export/
│           └── route.ts              # GET — returns PDF buffer
components/
├── notes/
│   ├── NotesPanel.tsx                # Observer panel (sticky input + list)
│   ├── NoteItem.tsx                  # Single note card with edit/delete
│   ├── NoteInput.tsx                 # Sticky bottom input (Enter/Shift+Enter)
│   └── RebuttalChecklist.tsx         # Speaker checklist with dnd-kit
├── pdf/
│   └── DebateNotesPdf.tsx            # @react-pdf/renderer Document component
hooks/
├── useNotesStore.ts                  # Zustand store for notes state
└── useNotesSync.ts                   # (optional) Realtime note subscription
supabase/
└── migrations/
    └── YYYYMMDD_notes_phase5.sql     # Schema corrections + new columns
```

### Pattern 1: Note CRUD API Routes (established project pattern)

**What:** All `listening` schema mutations go through Next.js route handlers using `pool.query()`, never PostgREST. Auth is JWT Bearer token verified via `verifyToken()` from `lib/auth/jwks.ts`.

**When to use:** Every note create, edit, delete, reorder operation.

**Example:**
```typescript
// Source: established pattern from app/api/debates/[debateId]/token/route.ts
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ debateId: string }> }) {
  const { debateId } = await params;

  // 1. Verify auth
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

  let userId: string;
  try {
    const payload = await verifyToken(bearer);
    userId = payload.sub as string;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // 2. Validate body with Zod
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  // 3. pool.query with explicit ownership
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO listening.notes (user_id, debate_id, content, debate_time_mmss, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, content, debate_time_mmss, created_at, is_edited`,
    [userId, debateId, parsed.data.content, parsed.data.debateTimeMmss],
  );

  return NextResponse.json({ note: rows[0] });
}
```

### Pattern 2: Zustand Notes Store (follows debateStore pattern)

**What:** Client-side state store for notes, mirroring the `debateStore` pattern.

**When to use:** All note state accessed by `NotesPanel`, `RebuttalChecklist`.

**Example:**
```typescript
// Source: pattern from store/debateStore.ts
'use client';
import { create } from 'zustand';

export interface NoteRow {
  id: string;
  content: string;
  debate_time_mmss: string;
  created_at: string;
  is_edited: boolean;
  rebuttal_order: number | null;
  is_checked: boolean;          // client-only, not persisted (checked = addressed)
}

interface NotesStoreState {
  notes: NoteRow[];
  setNotes(notes: NoteRow[]): void;
  addNote(note: NoteRow): void;
  updateNote(id: string, updates: Partial<NoteRow>): void;
  removeNote(id: string): void;
  reorderNotes(newOrder: string[]): void;  // array of note IDs
}

export const useNotesStore = create<NotesStoreState>((set) => ({
  notes: [],
  setNotes: (notes) => set({ notes }),
  addNote: (note) => set((s) => ({ notes: [...s.notes, note] })),
  updateNote: (id, updates) =>
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...updates } : n)) })),
  removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  reorderNotes: (ids) =>
    set((s) => ({
      notes: ids.map((id) => s.notes.find((n) => n.id === id)!).filter(Boolean),
    })),
}));
```

### Pattern 3: Drag-to-Reorder Rebuttal Checklist (@dnd-kit/core stable API)

**What:** `DndContext` + `SortableContext` + `useSortable` from `@dnd-kit/core` + `@dnd-kit/sortable`. Use `arrayMove` on drag end.

**When to use:** Speaker rebuttal checklist drag reorder.

**Example:**
```typescript
// Source: https://dndkit.com/legacy/presets/sortable/overview/
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function SortableNoteItem({ note }: { note: NoteRow }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: note.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {/* note content */}
    </div>
  );
}

function RebuttalChecklist({ notes }: { notes: NoteRow[] }) {
  const { reorderNotes } = useNotesStore();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = notes.findIndex((n) => n.id === active.id);
      const newIndex = notes.findIndex((n) => n.id === over.id);
      const newOrder = arrayMove(notes, oldIndex, newIndex).map((n) => n.id);
      reorderNotes(newOrder);
      // Fire-and-forget API call to persist rebuttal_order
      void persistReorder(newOrder);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={notes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
        {notes.map((note) => <SortableNoteItem key={note.id} note={note} />)}
      </SortableContext>
    </DndContext>
  );
}
```

### Pattern 4: PDF Generation with @react-pdf/renderer

**What:** Server-side PDF generation via a Next.js route handler.  `renderToBuffer()` returns a `Buffer` that is streamed directly as `application/pdf`.  No `next.config.ts` changes needed — `@react-pdf/renderer` is already on Next.js 15's built-in `serverExternalPackages` allowlist.

**When to use:** `GET /api/debates/[debateId]/notes/export`

**Example:**
```typescript
// Source: react-pdf.org/node and Next.js 15 serverExternalPackages allowlist
export const runtime = 'nodejs';  // Required — renderToBuffer needs Node.js runtime

import { renderToBuffer } from '@react-pdf/renderer';
import { DebateNotesPdf } from '@/components/pdf/DebateNotesPdf';

export async function GET(req: NextRequest, { params }: { params: Promise<{ debateId: string }> }) {
  const { debateId } = await params;

  // 1. Auth check (same Bearer token pattern)
  // 2. Fetch notes + transcript + debate metadata from pool.query()
  // 3. Render PDF
  const buffer = await renderToBuffer(
    <DebateNotesPdf debate={debateData} notes={notesData} transcript={transcriptData} />
  );

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="debate-notes-${debateId}.pdf"`,
    },
  });
}
```

**PDF Document component:**
```tsx
// Source: react-pdf.org/components
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { flexDirection: 'row', padding: 30 },
  transcriptColumn: { flex: 2, paddingRight: 16 },
  notesColumn: { flex: 1, borderLeft: '1px solid #ccc', paddingLeft: 16 },
  entry: { marginBottom: 8 },
  timestamp: { fontSize: 8, color: '#666' },
  text: { fontSize: 10 },
});

export function DebateNotesPdf({ debate, notes, transcript }) {
  return (
    <Document title={debate.title} author={debate.exporter_name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.transcriptColumn}>
          {/* transcript entries */}
        </View>
        <View style={styles.notesColumn}>
          {/* notes aligned by timestamp */}
        </View>
      </Page>
    </Document>
  );
}
```

### Pattern 5: Text Selection → "Add to Rebuttal" Floating Button

**What:** Speaker selects text in the TranscriptPanel → a floating button appears near the selection.  On click, the selected text is added to `listening.notes` as a rebuttal item.

**How:** Use `document.addEventListener('mouseup')` + `window.getSelection()` inside `TranscriptPanel` (only when user is a speaker role). Position the button using `getBoundingClientRect()` of the selection range.

**Example:**
```typescript
// Pattern: browser Selection API — no library needed
useEffect(() => {
  if (!isSpeaker) return;

  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
      setSelectionPopup(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelectionPopup({
      text: sel.toString().trim(),
      top: rect.top + window.scrollY - 36,
      left: rect.left + rect.width / 2,
    });
  }

  document.addEventListener('mouseup', handleMouseUp);
  return () => document.removeEventListener('mouseup', handleMouseUp);
}, [isSpeaker]);
```

### Anti-Patterns to Avoid

- **Direct Supabase client writes to `listening.notes`:** The `listening` schema is non-public; PostgREST does not expose it.  All note mutations must use `pool.query()` via API route handlers.
- **Using `@dnd-kit/react` (v0.4.0) for production:** It is pre-stable (0.x semver).  Use `@dnd-kit/core` stable API.
- **Client-side PDF generation with jsPDF + html2canvas:** Produces inconsistent rendering based on DOM state; not appropriate for a structured two-column layout.
- **Storing `is_checked` (addressed/unchecked) in the database:** Checkbox state is ephemeral per-session and specific to the speaker's in-debate cognitive state.  Keep it in Zustand client state only.
- **Auto-timestamping on input focus or keydown:** CONTEXT.md is explicit: timestamp is set on save (when the note is committed), not when typing starts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-to-reorder list | Custom mousedown/touchstart handlers | `@dnd-kit/sortable` | Keyboard accessibility, pointer vs touch sensors, auto-scroll, collision detection all handled |
| PDF two-column layout | Canvas drawing / html2canvas | `@react-pdf/renderer` | Flexbox layout in JSX, consistent font rendering, works server-side |
| PDF font embedding | Manual font loading | `@react-pdf/renderer` built-in fonts | Library handles font subsetting automatically |
| Selection popup positioning | Custom getBoundingClientRect math from scratch | Browser Selection API + `range.getBoundingClientRect()` is sufficient | No library needed for this specific use case; it's a simple positioned div |
| Notes subscription | Custom WebSocket | Supabase Realtime `postgres_changes` on `listening.notes` (same as `useTranscriptSync` broadcast pattern) | Already wired to the project |

**Key insight:** PDF generation looks simple until you try to align margin annotations with transcript entries at matching timestamps in a two-column layout.  That CSS-in-JS-to-PDF layout is exactly what `@react-pdf/renderer` was built for.  Don't build it with an imperative drawing API.

---

## Common Pitfalls

### Pitfall 1: RLS Policies Conflict with "Always Private" Decision

**What goes wrong:** The existing `notes_select_own_or_public` RLS policy (from Phase 1 migration `20260420000001_listening_rls_policies.sql`) allows reading notes where `is_private = false`.  If the pool's service-role bypasses RLS entirely, this doesn't matter for API routes — but `is_private` column still exists in the schema with `DEFAULT false`, meaning notes default to public at the DB level unless explicitly set to true.

**Why it happens:** Phase 1 schema was written before the "always private" design decision in CONTEXT.md.

**How to avoid:** Phase 5 migration must:
1. Drop `is_private` column (or add `NOT NULL DEFAULT true` constraint if column must remain for backward compat)
2. Drop `notes_select_own_or_public` RLS policy
3. Create new `notes_select_own` policy: `USING ((select auth.uid()) = user_id)`
4. Add `updated_at timestamptz`, `is_edited boolean DEFAULT false`, and `rebuttal_order integer` columns

**Warning signs:** Any query that returns notes from other users.

### Pitfall 2: Note Timestamp Means "Debate Time", Not Wall Clock

**What goes wrong:** Saving `NOW()` as the note timestamp gives a wall-clock timestamp that doesn't correlate with debate elapsed time.  The debate uses `debate_time_mmss` (e.g. `"4:32"`) which is a formatted string derived from the active segment's remaining time.

**Why it happens:** Conflating system clock with debate clock.

**How to avoid:** The `debate_time_mmss` must be computed on the client from the active segment's `end_time` (already available in `debateStore.getActiveSegment().end_time`).  The client sends it in the POST body; the API stores both `created_at = NOW()` (wall clock) and `debate_time_mmss` (debate clock string).

**Warning signs:** Notes whose timestamps don't appear to match where in the debate they were taken.

### Pitfall 3: Transcript Flag Button Appearing for Non-Speakers

**What goes wrong:** The "Add to rebuttal list" button on text selection is only meaningful for speakers.  If it renders for all authenticated users, observers see an irrelevant UI element.

**Why it happens:** The `TranscriptPanel` doesn't know the viewer's role.

**How to avoid:** Pass a `userRole: 'observer' | 'speaker' | 'moderator' | null` prop down to `TranscriptPanel`.  Only mount the selection listener when `userRole === 'speaker'`.  The speaker's role is derivable from `debateStore.speakers` by matching the JWT `sub` (userId) to `debate_speakers.user_id`.

### Pitfall 4: @react-pdf/renderer Requires `runtime = 'nodejs'`

**What goes wrong:** Next.js App Router defaults to Edge Runtime for route handlers.  `@react-pdf/renderer`'s `renderToBuffer` uses Node.js APIs (Buffer, stream) that don't exist in Edge Runtime.

**Why it happens:** Edge runtime is the default and silently fails or gives cryptic errors.

**How to avoid:** Add `export const runtime = 'nodejs';` at the top of every route handler file that uses `renderToBuffer`.  This is the same pattern already used in other route handlers in this project (e.g., `app/api/moderator/debates/[debateId]/transcript/[entryId]/route.ts`).

### Pitfall 5: dnd-kit DragOverlay for Smooth Visual Feedback

**What goes wrong:** Without a `DragOverlay`, the item being dragged shows its original position blinking out and back in.  The default behavior is functional but visually rough for a panel of small checklist items.

**Why it happens:** dnd-kit's default approach transforms the original node in place.

**How to avoid:** Add a `DragOverlay` component inside the `DndContext` that renders a ghost copy of the dragged item.  This is a well-documented dnd-kit pattern but is easy to omit on first pass.

### Pitfall 6: PDF Notes Alignment — Notes Whose Timestamps Fall Between Transcript Entries

**What goes wrong:** A note taken at debate time `3:15` may not correspond exactly to any transcript entry.  A naive "align note to exact-match transcript entry" produces gaps or misalignments.

**Why it happens:** Notes and transcript entries are independent time series.

**How to avoid (CONTEXT.md leaves this as Claude's Discretion):** Use "nearest earlier transcript entry" alignment — find the transcript entry with the highest `debate_time_mmss` that is ≤ the note's `debate_time_mmss`.  This means notes appear in the margin beside the transcript passage that was being spoken when the note was taken.  Notes with no earlier transcript entry appear at the top of the page before the first transcript line.

---

## Code Examples

### Schema Migration (Phase 5 data layer)

```sql
-- Source: established project migration pattern
-- Phase 5 migration: correct notes table for always-private design

-- 1. Add missing columns
ALTER TABLE listening.notes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rebuttal_order integer;   -- NULL = not in rebuttal list

-- 2. Remove is_private (notes are always private)
--    If migration must be backward-compatible, set NOT NULL DEFAULT true instead:
ALTER TABLE listening.notes DROP COLUMN IF EXISTS is_private;

-- 3. Replace RLS policies for always-private semantics
DROP POLICY IF EXISTS "notes_select_own_or_public" ON listening.notes;

CREATE POLICY "notes_select_own"
  ON listening.notes FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- INSERT/UPDATE/DELETE policies from Phase 1 remain valid — they already gate on user_id.
```

### Fetch JWT userId in a Notes API Route

```typescript
// Source: established pattern from lib/auth/jwks.ts + token route
import { verifyToken } from '@/lib/auth/jwks';

async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer) return null;
  try {
    const payload = await verifyToken(bearer);
    return payload.sub as string;
  } catch {
    return null;
  }
}
```

### @react-pdf/renderer Two-Column Layout Structure

```tsx
// Source: react-pdf.org/components — two-column margin annotation layout
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10 },
  header: { marginBottom: 16, borderBottom: '1px solid #999', paddingBottom: 8 },
  headerTitle: { fontSize: 14, fontWeight: 'bold' },
  headerMeta: { fontSize: 9, color: '#666', marginTop: 4 },
  body: { flexDirection: 'row' },
  transcriptCol: { flex: 2, paddingRight: 12 },
  notesCol: { flex: 1, paddingLeft: 12, borderLeft: '1px solid #ddd' },
  entryRow: { marginBottom: 6 },
  speakerLabel: { fontSize: 8, color: '#888', textTransform: 'uppercase' },
  entryText: { fontSize: 10, lineHeight: 1.4 },
  noteAnnotation: { fontSize: 9, fontStyle: 'italic', color: '#444', marginBottom: 8 },
  noteTimestamp: { fontSize: 7, color: '#999' },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-beautiful-dnd` (Atlassian, abandoned) | `@dnd-kit/core` + `@dnd-kit/sortable` | 2022 | dnd-kit is the actively-maintained replacement; same conceptual model |
| `serverComponentsExternalPackages` (Next.js 14) | `serverExternalPackages` (Next.js 15) | Next.js 15.0 | Renamed config key; `@react-pdf/renderer` is on the built-in allowlist in both |
| Notes `is_private = false` by default (Phase 1 schema) | Notes always private (Phase 5 decision) | Phase 5 CONTEXT.md | Requires schema migration to drop `is_private` and replace RLS policy |

**Deprecated/outdated:**
- `react-beautiful-dnd`: Atlassian abandoned it; the hello-pangea fork exists but dnd-kit is the recommended migration path per dnd-kit's own docs.
- `@dnd-kit/react` v0.4.0: Pre-stable; do not use for production until 1.0.

---

## Open Questions

1. **Connected-tier check in note creation**
   - What we know: NOTES-01 says "Connected accounts can create timestamped notes"; the `AccountMe` type has `tier: 'inform' | 'connected' | 'empowered'`
   - What's unclear: Should the API route verify `tier === 'connected' || tier === 'empowered'` by calling `/api/account/me`, or is it sufficient to rely on the JWT being valid (any authenticated user)?
   - Recommendation: Call `/api/account/me` with the Bearer token before allowing note creation.  The `getAccountMe()` function in `lib/auth/account.ts` is already `cache()`-wrapped for React Server Component use, but in a route handler context you'd call it directly.  The check is a single extra HTTP call that enforces the business rule.

2. **Rebuttal checklist persistence strategy for `is_checked`**
   - What we know: CONTEXT.md says checkbox "marks each item as addressed."  No mention of persistence.
   - What's unclear: Should `is_checked` survive a page reload?  If a speaker closes/reopens their browser mid-debate, do they lose checked state?
   - Recommendation: Keep `is_checked` as ephemeral Zustand state only (no DB column, no API call).  Rationale: the rebuttal checklist is a live in-debate tool, not a persistent record.  The note itself (content, timestamp) is persisted; the "addressed" state is a real-time cognitive bookmark.

3. **Transcript flag source data for rebuttal notes**
   - What we know: Speaker selects transcript text → floating button → note added with that text as content.
   - What's unclear: Should the `transcript_entry_id` FK be stored on the note?  This would enable linking back to the source entry.
   - Recommendation: Add `source_transcript_entry_id uuid REFERENCES listening.transcript_entries(id)` as a nullable column in the Phase 5 migration.  When a note is created from a transcript selection, populate it.  When typed manually, leave NULL.  This enables future features (e.g., highlight the source in the transcript when hovering a rebuttal item) at zero cost now.

---

## Sources

### Primary (HIGH confidence)
- Next.js 15 official docs (fetched 2026-04-27) — `serverExternalPackages` config; confirmed `@react-pdf/renderer` is on the built-in allowlist
- `react-pdf.org/node` (fetched 2026-04-27) — `renderToBuffer` API
- `react-pdf.org/compatibility` (fetched 2026-04-27) — React 19 support since v4.1.0
- `dndkit.com/legacy/presets/sortable/overview/` (fetched 2026-04-27) — stable `@dnd-kit/core` API with SortableContext/useSortable/arrayMove
- Project codebase (read directly) — debateStore.ts, useTranscriptSync.ts, pool.ts, jwks.ts, RLS migration, notes table schema

### Secondary (MEDIUM confidence)
- WebSearch 2026 — @react-pdf/renderer vs jsPDF vs pdfmake comparison; multiple sources agree on server-side recommendation
- WebSearch 2026 — dnd-kit vs @hello-pangea/dnd comparison; multiple sources recommend dnd-kit for production

### Tertiary (LOW confidence)
- WebSearch — `@dnd-kit/react` v0.4.0 stability status (maintainer discussion unanswered; pre-stable version confirmed via npm, but production readiness not formally addressed)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — library versions confirmed via npm; Next.js allowlist confirmed via official docs; React 19 compat confirmed via react-pdf.org
- Architecture: HIGH — follows established codebase patterns (pool.query, verifyToken, Zustand); new patterns (dnd-kit, react-pdf) are well-documented
- Pitfalls: HIGH — schema conflict (is_private) is a verified reading of existing migration files; runtime pitfall is verifiable from next.config.ts pattern already in codebase
- PDF alignment for notes between transcript entries: MEDIUM — recommended approach is logical but not the only valid choice (CONTEXT.md explicitly defers this to Claude's Discretion)

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days — stable libraries; dnd-kit v2 migration watch: check @dnd-kit/react for 1.0 before next phase)
