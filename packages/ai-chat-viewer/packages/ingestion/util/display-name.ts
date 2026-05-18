import { basename, dirname } from "node:path";

// Three-level basename-disambiguation for project display names.
//
// Spec: deep-interview T23. Two projects with the same basename (e.g.
// /Users/jane/work/web and /Users/jane/personal/web) must render
// distinguishably in the homepage list (AC-4) without dumping the full
// cwd by default.
//
// Algorithm (deterministic, no fallback layering — this IS the spec):
//   ① group all cwds by basename.
//   ② singleton group → keep bare basename ("web").
//   ③ collision → re-key the colliding members by `${basename} (${parent})`.
//   ④ if step-3 keys still collide → re-key by
//      `${basename} (${grandparent}/${parent})`.
//   ⑤ if step-4 keys still collide → use the full cwd as the displayName
//      (no further escalation; the user typed the path, they get the path).
//
// Why this lives in ingestion (not server): the runner is the *writer* of
// Project rows. When it observes a new project (or any change to the
// project set), it calls `computeDisplayNames` over all known cwds in one
// shot and writes back. The server consumes `Project.displayName` from the
// DB — it does not re-disambiguate at read time. Batch API (cwds[] →
// Map<cwd, displayName>) matches that usage: the runner has all cwds in
// hand whenever it adds one.

// Returns the parent directory's basename, or "" when the cwd has no
// usable parent (root, single-segment paths). path.dirname("/") === "/"
// so we guard explicitly.
function parentBasename(cwd: string): string {
  const parent = dirname(cwd);
  if (parent === cwd || parent === "/" || parent === "." || parent === "") {
    return "";
  }
  return basename(parent);
}

function grandparentBasename(cwd: string): string {
  const parent = dirname(cwd);
  if (parent === cwd) return "";
  const grand = dirname(parent);
  if (grand === parent || grand === "/" || grand === "." || grand === "") {
    return "";
  }
  return basename(grand);
}

// Group items by the key produced by `keyOf`. Returns a Map preserving
// first-seen insertion order so output is deterministic given a
// deterministic input order.
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const bucket = out.get(k);
    if (bucket) {
      bucket.push(item);
    } else {
      out.set(k, [item]);
    }
  }
  return out;
}

// Public API: cwds in → Map<cwd, displayName> out. Deterministic across
// runs given the same input set; insertion order in the returned Map
// follows the *input* order (Map preserves insertion order in JS), so the
// caller doesn't have to re-sort.
//
// The caller is the runner. Typical usage:
//   const cwds = await prisma.project.findMany({ select: { cwd: true } });
//   const names = computeDisplayNames(cwds.map(p => p.cwd));
//   for (const [cwd, name] of names) {
//     await prisma.project.update({ where: { cwd }, data: { displayName: name } });
//   }
export function computeDisplayNames(cwds: readonly string[]): Map<string, string> {
  // Resolved map: cwd → displayName. We mutate this through the cascade.
  const resolved = new Map<string, string>();

  // Step ①+② / ③ — group by basename. Singletons resolve immediately.
  const byBase = groupBy(cwds, (cwd) => basename(cwd) || cwd);

  for (const [base, group] of byBase) {
    if (group.length === 1) {
      const only = group[0]!;
      resolved.set(only, base);
      continue;
    }

    // Step ③ — escalate to "{basename} ({parent})".
    const byParent = groupBy(group, (cwd) => {
      const par = parentBasename(cwd);
      return par === "" ? cwd : `${base} (${par})`;
    });

    for (const [parentKey, subgroup] of byParent) {
      if (subgroup.length === 1) {
        const only = subgroup[0]!;
        resolved.set(only, parentKey);
        continue;
      }

      // Step ④ — escalate to "{basename} ({grandparent}/{parent})".
      const byGrand = groupBy(subgroup, (cwd) => {
        const gp = grandparentBasename(cwd);
        const par = parentBasename(cwd);
        if (gp === "" || par === "") return cwd;
        return `${base} (${gp}/${par})`;
      });

      for (const [grandKey, subsubgroup] of byGrand) {
        if (subsubgroup.length === 1) {
          const only = subsubgroup[0]!;
          resolved.set(only, grandKey);
          continue;
        }
        // Step ⑤ — give up and use full cwd. Deterministic: each member
        // gets its own cwd, which by definition is unique per project.
        for (const item of subsubgroup) {
          resolved.set(item, item);
        }
      }
    }
  }

  // Reorder result to match input order — Map insertion order above
  // follows whichever group the cwd landed in, not input order. Rebuild
  // a fresh Map walking inputs to give callers a deterministic iteration.
  const ordered = new Map<string, string>();
  for (const cwd of cwds) {
    const name = resolved.get(cwd);
    ordered.set(cwd, name ?? (basename(cwd) || cwd));
  }
  return ordered;
}
