import type { CanvasImageHistory } from "@infinite-canvas/shared/storage-data";
import { collectStringValues } from "@infinite-canvas/shared/resource-references";
import { assetLibrarySchema, defaultAssetFolderId, type StoredAsset } from "@infinite-canvas/shared/sync-records";
import type { ModelTask } from "@infinite-canvas/shared/model-http";

export type RemovedImage = { projectId: string; nodeId: string; key: string };
export type ImageRetention = { sessions: { id: string; projectId: string; keys: string[] }[]; pending: RemovedImage[] };

export function updateImageRetention(state: ImageRetention, projectId: string, history: CanvasImageHistory) {
    const sessions = state.sessions.filter(session => session.id !== history.sessionId);
    if (history.retained.length) sessions.push({ id: history.sessionId, projectId, keys: history.retained });
    sessions.sort((a, b) => a.id.localeCompare(b.id));
    const pending = new Map(state.pending.map(item => [JSON.stringify([item.projectId, item.nodeId, item.key]), item]));
    for (const { nodeId, keys } of history.removed) for (const key of keys) {
        pending.set(JSON.stringify([projectId, nodeId, key]), { projectId, nodeId, key });
    }
    return { sessions, pending: [...pending.values()] };
}

function automaticAsset(asset: StoredAsset, owners: RemovedImage[]) {
    return asset.kind === "image" && owners.some(item => item.key === asset.data.storageKey && item.nodeId === asset.metadata?.nodeId)
        && asset.metadata?.source === "canvas" && asset.updatedAt === asset.createdAt && !asset.note
        && (!asset.folderId || asset.folderId === defaultAssetFolderId);
}

/** 先从引用检查中扣除本次删除节点自动登记的条目，其他记录中的同键仍然保护原件。 */
export function inspectImageLibrary(value: unknown, owners: RemovedImage[], used: Set<string>) {
    const library = assetLibrarySchema.parse(value);
    const automatic = library.state.assets.filter(asset => automaticAsset(asset, owners));
    const ids = new Set(automatic.map(asset => asset.id));
    const original = value as typeof library;
    collectStringValues({ ...original, state: { ...original.state, assets: original.state.assets.filter(asset => !ids.has(asset.id)) } }, used);
    return automatic;
}

type TaskRecord = { snapshot: ModelTask };
export function detachableResults(value: TaskRecord, owners: RemovedImage[], used: Set<string>) {
    const task = value.snapshot, target = task.target;
    if (task.action !== "image" || task.status !== "completed" || target?.page !== "canvas" || !Array.isArray(task.result) || used.has(task.taskId)) {
        collectStringValues(value, used);
        return [];
    }
    const detached = task.result.filter(asset => asset.collection === "images" && owners.some(
        item => item.projectId === target.projectId && item.nodeId === target.nodeId && item.key === asset.key));
    const result = task.result.filter(asset => !detached.includes(asset));
    collectStringValues({ ...value, snapshot: { ...task, target: undefined, result } }, used);
    return detached;
}
