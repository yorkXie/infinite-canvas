import { nanoid } from "nanoid";
import type { CanvasNodeData, CanvasNodeImage, CanvasNodeMetadata } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { UploadedImage } from "@workbench/services/image-storage";
import { fitImageInNode } from "./canvas-node-size";

export function imageSlot(image: Omit<UploadedImage, "url"> & { url?: string }, id: string, model?: string, createdAt?: number): CanvasNodeImage {
    return { id, content: image.url ?? "", storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, model, createdAt };
}

export function imageMetadata(image: Omit<UploadedImage, "url"> & { url?: string }, model?: string, createdAt?: number): CanvasNodeMetadata {
    const item = imageSlot(image, nanoid(), model, createdAt);
    return { ...primaryImageFields(item), status: "success", images: [item] };
}

export function primaryImageFields(image?: CanvasNodeImage) {
    return { primaryImageId: image?.id, content: image?.content, storageKey: image?.storageKey, naturalWidth: image?.naturalWidth, naturalHeight: image?.naturalHeight, bytes: image?.bytes, mimeType: image?.mimeType };
}

export function currentNodeImage(meta?: { primaryImageId?: string; storageKey?: string; content?: string; images?: readonly CanvasNodeImage[] }) {
    if (!meta?.images?.length) return;
    const matches = (image: CanvasNodeImage) => meta.storageKey ? image.storageKey === meta.storageKey : Boolean(meta.content && image.content === meta.content);
    return meta.images.find((image) => image.id === meta.primaryImageId && matches(image)) ?? meta.images.find(matches);
}

export function savedNodeImages(meta?: CanvasNodeMetadata): CanvasNodeImage[] {
    const images = meta?.images?.filter((image) => image.storageKey || image.content) ?? [];
    if (!meta?.storageKey && !meta?.content) return images;
    const primary = currentNodeImage(meta);
    if (primary) return [primary, ...images.filter((image) => image.id !== primary.id)];
    // 单图节点可能只在节点本身保存了原件。
    const item: CanvasNodeImage = { id: nanoid(), status: "success", content: meta.content ?? "", storageKey: meta.storageKey,
        naturalWidth: meta.naturalWidth ?? 0, naturalHeight: meta.naturalHeight ?? 0, bytes: meta.bytes ?? 0, mimeType: meta.mimeType ?? "" };
    return [item, ...images];
}

/** 结果按生成槽位回填。先展示本轮已成功的第一张，用户手动置顶的图保持优先。 */
export function completeBatchImage(node: CanvasNodeData, image: CanvasNodeImage): CanvasNodeData {
    const previous = node.metadata?.images;
    if (!previous?.some((slot) => slot.id === image.id)) return node;
    const images = previous.map((slot) => slot.id === image.id ? image : slot);
    const primary = images.find((slot) => slot.status === "success" && (slot.storageKey || slot.content));
    const metadata = { ...node.metadata, images };
    if (!primary || (primary.id === node.metadata?.primaryImageId && primary.id !== image.id)) return { ...node, metadata };
    return { ...node, ...fitImageInNode(node, primary.naturalWidth, primary.naturalHeight), metadata: { ...metadata, ...primaryImageFields(primary) } };
}
