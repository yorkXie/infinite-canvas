import { Download, Star } from "lucide-react";
import { toast } from "sonner";
import type { CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { ImageThumbnail } from "@workbench/components/image-thumbnail";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { decodeGroupModel, findModelGroup, modelOptionName, useConfigStore } from "@workbench/stores/use-config-store";

type DetailsProps = {
    node?: CanvasNodeData;
    preview: { url?: string; title: string; slotId?: string };
    onView: (slotId: string) => Promise<void>;
    onPrimary: (slotId: string) => Promise<void>;
    onDownload: () => Promise<void>;
};

const originalImageSize = "absolute inset-0 size-full object-scale-down sm:static sm:size-auto sm:max-h-[min(82dvh,calc(100dvh_-_5.5rem))] sm:max-w-[calc(92vw_-_330px)]";

export function CanvasImageDetails({ node, preview, onView, onPrimary, onDownload }: DetailsProps) {
    const meta = node?.metadata;
    const images = meta?.images?.filter((image) => image.storageKey || image.content) ?? [];
    const selected = images.find((image) => image.id === preview.slotId);
    const channels = useConfigStore((state) => state.config.channels);
    const decoded = selected?.model && decodeGroupModel(selected.model);
    const group = !selected?.modelSource && decoded ? findModelGroup(channels, decoded.groupId) : undefined;
    const source = selected?.modelSource ?? (group && { channelName: group.channel.name, groupName: group.group.name });
    const modelName = selected?.model ? modelOptionName(selected.model) : "模型未记录";
    const width = selected?.naturalWidth ?? meta?.naturalWidth;
    const height = selected?.naturalHeight ?? meta?.naturalHeight;
    const primary = selected?.id === (meta?.primaryImageId ?? images[0]?.id);
    const reportError = (error: unknown) => toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
    return <div className="flex h-[65dvh] w-[calc(100vw_-_4rem)] flex-col gap-3 sm:h-auto sm:w-max sm:max-h-[min(82dvh,calc(100dvh_-_5.5rem))] sm:flex-row">
        {images.length > 1 && <nav aria-label="组内图片" className="flex min-h-0 shrink-0 gap-2 overflow-auto p-1 sm:w-16 sm:flex-col">
            {images.map((image, index) => <button type="button" key={image.id}
                aria-label={`查看第 ${index + 1} 张图片`} aria-pressed={selected?.id === image.id}
                className="size-12 shrink-0 overflow-hidden rounded opacity-65 hover:opacity-100 focus-visible:outline-2 aria-pressed:opacity-100 aria-pressed:outline-2 aria-pressed:outline-offset-1"
                onClick={() => { void onView(image.id).catch(reportError); }}>
                {image.storageKey ? <ImageThumbnail storageKey={image.storageKey} alt="" className="size-full" /> : <img src={image.content} alt="" className="size-full object-cover" />}
            </button>)}
        </nav>}
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center sm:flex-none">
            {preview.url ? <img src={preview.url} alt={preview.title} className={originalImageSize} /> : <>
                {!!width && !!height && <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={originalImageSize} />}
                <span role="status" className={`text-sm opacity-60 ${width && height ? "absolute" : ""}`}>正在读取原图…</span>
            </>}
        </div>
        <aside className="flex min-w-0 flex-wrap items-start gap-3 overflow-auto border-t border-current/15 pt-3 text-sm sm:w-40 sm:flex-col sm:flex-nowrap sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
            <dl className="flex flex-wrap gap-3 sm:flex-col">
                {!!width && !!height && <div><dt className="text-xs opacity-60">分辨率</dt><dd className="tabular-nums">{width} × {height}</dd></div>}
                <div><dt className="text-xs opacity-60">生成模型</dt><dd className="break-all">{modelName}（{source ? `${source.channelName}-${source.groupName}` : "渠道 / 分组未记录"}）</dd></div>
                {selected?.createdAt !== undefined && <div><dt className="text-xs opacity-60">生成时间</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>}
            </dl>
            {selected && <Button type="button" variant="ghost" size="sm" disabled={primary} onClick={() => void onPrimary(selected.id).catch(reportError)}>
                <Star className="size-4" />{primary ? "当前主图" : "设为主图"}
            </Button>}
            <Button type="button" variant="ghost" size="sm" disabled={!preview.url} onClick={() => void onDownload().catch(reportError)}><Download className="size-4" />下载原图</Button>
        </aside>
    </div>;
}
