# GHL OPS SETUP — Phase 8.7 (your build-sheet)

Adds the operations layer to the GoHighLevel sandbox: the ride calendar, four new
fields, and the sub-account settings the workflows need. ~15 minutes.

**When done**, run `npm run ghl:ids` — it resolves the new IDs and **fails loudly**
if anything is missing or misnamed. That command is the check on this whole sheet.

> Same sub-account as everything else (`BhxPrWhgU4bdMXz6meYe`). Field key must
> come out exactly as written — GHL derives the key from the name, so type names
> exactly. After saving a field, click back in to confirm the key.

---

## Step 1 — Create the ride calendar — DONE ✓

Calendar `PSDLimo Rides` exists (id `mbiZTjEQc8qtnVYl413q`), with the owner set
as its team member. Verified 2026-07-24 by creating a real appointment on it.

Two things learned while wiring this up (recorded so they are not rediscovered):
- A GHL appointment **requires an `assignedUserId`**. The code resolves the
  calendar's own selected team member dynamically, so it keeps working when the
  roster changes at go-live — no hardcoded user id.
- Rides are booked for specific times and must not be rejected for falling
  outside the calendar's availability windows. The parameter that bypasses this
  is **`ignoreFreeSlotValidation: true`** (not `ignoreDateRange`, which did not
  work). Already in the code.

The webhook writes one appointment per paid booking here: start = pickup time,
end = computed ride end. This is the time-precise anchor every timed workflow
keys off (GHL date fields truncate the time, so appointments carry it).

---

## Step 2 — Add 3 opportunity fields

**Settings → Custom Fields → Add Field**, **Object = Opportunity** for all three.

| Field name (type exactly) | Type | Notes |
|---|---|---|
| `Chauffeur Assigned` | Single Line Text | **The owner's one manual field.** Type the driver's name, then drag to Assigned. |
| `Chauffeur Phone` | Phone | Optional; enriches the ride card. |
| `Appointment Id` | Single Line Text | **Written by the webhook** — retry-safety so a re-sent callback doesn't create a second appointment. Owner never touches it. |

Expected keys: `opportunity.chauffeur_assigned`, `opportunity.chauffeur_phone`,
`opportunity.appointment_id`.

---

## Step 3 — Company Name — NOTHING TO DO

`Company Name` is a GHL **standard** contact field, so it already exists and
cannot be added as a custom field. Confirmed 2026-07-24. The webhook writes it as
the standard `companyName` on the contact body (verified: stored and read back
correctly), NOT via a custom field. No action needed here.

---

## Step 4 — Pre-create the new tags (optional but tidy)

**Settings → Tags → Add Tag.** GHL auto-creates tags on first use, so this only
catches typos early. All lowercase, **dot-separated**:

```
service.intercity
service.winetour
service.group
service.corporate
client.corporate
```

(The 6 original tags already exist.)

---

## Step 5 — Confirm sub-account settings

These matter for the workflows in Phase 10. Confirm now so nothing surprises us later.

| Setting | Where | Value |
|---|---|---|
| Timezone | Settings → Business Profile → Time Zone | **America/Los_Angeles** (verify) |
| Allow Multiple Opportunities per Contact | Settings → Objects → Opportunities | **ON** (already done ✓ — verified via API) |
| Allow duplicate contacts | same area | **OFF** (already correct ✓) |

Workflow **re-entry** and **email domain** settings come up in Phase 10, not now.

---

## Step 6 — Run the resolver

```
npm run ghl:ids
```

It must end with `✓ Wrote config/ghl-fields.json` and no `✖ problem(s)`. It will:

- resolve the 3 new opportunity fields + `company_name` to their IDs
- resolve the **PSDLimo Rides** calendar id
- warn (not fail) about any tag it can't find

If it names a missing field, that field's name or object is wrong — fix and re-run.

---

## Token scopes — already done

Verified 2026-07-24: the existing Private Integration token already has
`calendars.readonly`, `calendars/events.readonly`, and `calendars/events.write`.
**No token change needed.** If `ghl:ids` ever returns 401 on a `/calendars` call,
that assumption changed — tell me.

---

## What happens after this sheet

`ghl:ids` writing the calendar id + 4 field ids into `config/ghl-fields.json` is
what activates the code already written in Phase 8:

- the webhook starts writing `company_name` on corporate bookings
- the webhook starts creating a calendar **appointment** per paid ride and
  recording its `appointment_id`

Then a test booking will show an appointment on the PSDLimo Rides calendar — the
foundation the Phase 9 gate and the Phase 10 workflows stand on.
