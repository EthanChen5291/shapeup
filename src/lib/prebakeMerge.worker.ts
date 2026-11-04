// Worker entry for lib/prebakeMerge: all logic lives in createMergeCore.
import { createMergeCore, type MergeProgress, type MergeWorkerRequest } from './prebakeMergeCore';

// TypeScript types this file against the window; it only ever runs as a Worker, whose
// postMessage takes a transfer list. Declared locally so tsconfig's lib stays "dom".
const scope = self as unknown as {
  addEventListener(type: 'message', fn: (e: MessageEvent<MergeWorkerRequest>) => void): void;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};
const core = createMergeCore();
scope.addEventListener('message', (e: MessageEvent<MergeWorkerRequest>) => {
  void core.handle(e.data, (p: MergeProgress) => scope.postMessage(p)).then((res) => {
    if (!res) return;
    if (res.type === 'merged') scope.postMessage(res, [res.bytes]);
    else scope.postMessage(res);
  });
});
