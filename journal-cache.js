const prefix = 'medicine-service.account-cache.v1.';

export function createJournalCache(storage, validate) {
  return {
    read(userId) {
      if (!userId) return null;
      try {
        const cached = JSON.parse(storage.getItem(prefix + userId));
        if (cached?.userId !== userId || !Number.isSafeInteger(cached.revision) ||
            cached.revision < 0 || !Number.isFinite(cached.savedAt)) return null;
        return { ...cached, state: validate(cached.state) };
      } catch {
        return null;
      }
    },
    write(userId, state, revision) {
      if (!userId) return;
      try {
        storage.setItem(prefix + userId, JSON.stringify({
          userId, state: validate(state), revision, savedAt: Date.now()
        }));
      } catch {
        // Cloud reads and writes remain usable when local storage is unavailable or full.
      }
    },
    remove(userId) {
      if (!userId) return;
      try { storage.removeItem(prefix + userId); } catch {}
    }
  };
}
