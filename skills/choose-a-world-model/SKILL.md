---
name: choose-a-world-model
description: Shortlist world models and scene generators for a task, with the licence clause, read date and hardware catches attached. Use when someone asks which world model to use, whether one allows commercial use, which export a splat or a mesh, or whether one fits their GPU.
---

# Choose a world model

This skill answers "which world model should I use" from the World Model Registry, where every clause is
quoted from the vendor's own page with the date it was read. It needs the `world-model-registry-mcp`
server. If the tools below are not available, use the same queries from the CLI:
`npx github:rishsadh/world-model-registry-mcp <command>`.

## Steps

1. Get three facts from the person, asking only for what is missing.
   - The job, in a few words. Is it a walkthrough, a game prototype, a web splat viewer, a 360 background,
     client-facing work, a real-time interactive world, or a robot or driving simulation?
   - Whether the output will be used commercially.
   - Their GPU memory in GB, or whether a hosted tool is fine.
2. Call `registry_choose` with the matching task and any needs.

   | Job | task |
   |---|---|
   | Walk around a generated scene | `walkthrough` |
   | Put a scene in a game engine | `game-prototype` |
   | Show a Gaussian splat on the web | `web-splat` |
   | A 360 panorama or skybox | `panorama-background` |
   | Client-facing scene, render or panorama | `marketing-scene` |
   | Steer a world in real time | `realtime-interactive` |
   | Robot or driving simulation | `robot-or-driving-sim` |

   Add `commercial`, `fits_vram_gb` and `local` when the person gave them. For a question that is not one of
   these jobs, use `registry_search` with the same filters.
3. For each model you will mention, call `registry_get` with `detail: clauses`. Read the quoted grant and every
   restriction before you describe the licence.
4. For a GPU question, call `registry_fit` with their VRAM. Report the verdict and the quoted figure with the
   clause it sits in.
5. If the person asks about latency or frame rate, call `registry_reported`. Say these are vendor-reported.
6. If a vendor has been in the news, call `registry_changes` with `id` to see whether its terms moved.

## How to answer

For each model, give:

- What you get: the file types.
- The clause: quote it, with its section and source URL, and say "read on" with the date.
- The catches: every flag the registry attaches, in plain words.
- Hardware: the quoted figure and where it came from, or "not published".

End with the registry version and last-verified date, and one line saying clauses can change after the read date.

## Rules

- Quote, do not paraphrase a licence. If you must summarise, keep the quote beside it.
- Never write "free for commercial use" or "safe to use" unless a quoted clause says so in those words. The state
  `conditions` means a grant exists with conditions attached. The state `conflict` means a clause or a source says
  no, or two sources disagree. Show both sides.
- Say "not published" where the registry does. Do not fill a gap from memory.
- Do not rank. The registry has no scores, and the result order is not a preference. Give the shortlist and the
  catches and let the person choose.
- Wrappers resell another model. The underlying vendor's terms still govern the output.
- If `registry.stale_warning` appears, say so and suggest `update`.
- For client work, tell the person to open the source URL and read the clause themselves. This is not legal advice.
