/** Serial saves bound to the identity and immutable snapshot that scheduled them. */
export function createSaveQueue<T>(write: (snapshot: T, owner: string) => Promise<void>, currentOwner: () => string | null, delay = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let serial = Promise.resolve();
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const save = (snapshot: T, owner: string) => {
    cancel();
    const next = serial.catch(() => {}).then(async () => {
      if (currentOwner() !== owner) return;
      await write(snapshot, owner);
    });
    serial = next;
    return next;
  };
  return { cancel, save, schedule(snapshot: T, owner: string, onError: (error: unknown) => void) {
    cancel();
    timer = setTimeout(() => { void save(snapshot, owner).catch(onError); }, delay);
  } };
}