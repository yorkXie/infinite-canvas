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

/** 每张成功的新图置顶。恢复任务可能乱序返回，用实际完成时间与手动置顶时间还原顺序。 */
export function completeBatchImage(node: CanvasNodeData, image: CanvasNodeImage, options: { allowNewSlot?: boolean; recovered?: boolean } = {}): CanvasNodeData {
    const previous = node.metadata?.images ?? [];
    const slot = previous.find((item) => item.id === image.id);
    if (!slot && !options.allowNewSlot) return node;
    if (options.recovered && slot?.status === "success" && slot.storageKey && slot.storageKey === image.storageKey) return node;

    const newer: CanvasNodeImage[] = [];
    const others: CanvasNodeImage[] = [];
    for (const item of previous) {
        if (item.id === image.id) continue;
        const movedAt = item.promotedAt ?? item.createdAt;
        if (options.recovered && image.createdAt !== undefined && movedAt !== undefined && movedAt > image.createdAt && (item.storageKey || item.content)) newer.push(item);
        else others.push(item);
    }
    const images = [...newer, image, ...others];
    const primary = images[0];
    const metadata = { ...node.metadata, images };
    if (primary.id === node.metadata?.primaryImageId && primary.id !== image.id) return { ...node, metadata };
    return { ...node, ...fitImageInNode(node, primary.naturalWidth, primary.naturalHeight), metadata: { ...metadata, ...primaryImageFields(primary) } };
}
