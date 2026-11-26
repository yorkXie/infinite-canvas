import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";

export function fitImageInNode(node: ReadonlyCanvasNode, naturalWidth: number, naturalHeight: number) {
    if (node.metadata?.freeResize || naturalWidth <= 0 || naturalHeight <= 0) {
        return { width: node.width, height: node.height, position: node.position };
    }
    const scale = Math.min(node.width / naturalWidth, node.height / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    return { width, height, position: { x: node.position.x + (node.width - width) / 2, y: node.position.y + (node.height - height) / 2 } };
}

export function fitNodeSize(width: number, height: number, maxWidth = 640, maxHeight = 640) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}
