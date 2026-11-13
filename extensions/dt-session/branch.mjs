/** Cache session metadata without rebuilding the whole history on every input. */
export const WORKFLOW = "dt-workflow";
const relevant = (entry) => entry.type === "custom" && ["dt-project", "dt-scope-proposal", WORKFLOW].includes(entry.customType);

export function createBranchReader() {
  let cache;
  return {
    invalidate() { cache = undefined; },
    read(manager) {
      // Small test doubles and older hosts can still use the full branch API.
      if (!manager.getLeafId || !manager.getEntry) return manager.getBranch().filter(relevant);
      const session = manager.getSessionId(), leaf = manager.getLeafId();
      if (cache?.manager === manager && cache.session === session && cache.leaf === leaf) return cache.entries;
      const appended = [];
      let cursor = leaf;
      if (cache?.manager === manager && cache.session === session) {
        while (cursor && cursor !== cache.leaf) {
          const entry = manager.getEntry(cursor);
          if (!entry) break;
          if (relevant(entry)) appended.push(entry);
          cursor = entry.parentId;
        }
        if (cursor === cache.leaf) {
          cache = { manager, session, leaf, entries: appended.length ? [...cache.entries, ...appended.reverse()] : cache.entries };
          return cache.entries;
        }
      }
      // Tree navigation may select a different ancestry, not just append to it.
      cache = { manager, session, leaf, entries: manager.getBranch().filter(relevant) };
      return cache.entries;
    },
  };
}
