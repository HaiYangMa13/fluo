import { firstMediaUrl, normalizeMediaUrl } from './MediaUrl';

export interface WeiboMediaSize { url?: string; }
export interface WeiboMediaPicture {
  url?: string;
  original?: WeiboMediaSize;
  largest?: WeiboMediaSize;
  mw2000?: WeiboMediaSize;
  large?: WeiboMediaSize;
  largecover?: WeiboMediaSize;
  bmiddle?: WeiboMediaSize;
  thumbnail?: WeiboMediaSize;
  type?: string;
  videoSrc?: string;
  video?: string;
}

export interface WeiboMixedMediaItem {
  type?: string;
  data?: WeiboMediaPicture;
}

export interface WeiboMixedMediaInfo { items?: WeiboMixedMediaItem[]; }

export function weiboMixedPictures(mixed?: WeiboMixedMediaInfo): WeiboMediaPicture[] {
  const pictures: WeiboMediaPicture[] = [];
  for (const item of mixed?.items ?? []) {
    if ((item.type === 'pic' || item.type === 'livephoto') && item.data !== undefined && item.data !== null) {
      pictures.push(item.data);
    }
  }
  return pictures;
}

export function weiboPictureUrl(picture: WeiboMediaPicture): string {
  return firstMediaUrl([picture.original?.url, picture.largest?.url, picture.mw2000?.url,
    picture.large?.url, picture.largecover?.url, picture.url, picture.bmiddle?.url, picture.thumbnail?.url]);
}

/** Also accepts legacy route maps whose keys predate URL normalization. */
export function normalizeLivePhotoTracks(tracks: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(tracks)) {
    const url: string = normalizeMediaUrl(key);
    const video: string = firstMediaUrl([tracks[key]], true);
    if (url.length > 0 && video.length > 0) { result[url] = video; }
  }
  return result;
}

/** Keep still/video pairing by URL, not by filtered grid index. No invented video URLs. */
export function weiboLivePhotoTracks(mobile: WeiboMediaPicture[], desktop?: Record<string, WeiboMediaPicture>,
  mixed?: WeiboMixedMediaInfo): Record<string, string> {
  const result: Record<string, string> = {};
  const entries: WeiboMediaPicture[] = mobile.slice();
  if (desktop !== undefined) { for (const id of Object.keys(desktop)) { entries.push(desktop[id]); } }
  entries.push(...weiboMixedPictures(mixed));
  for (const item of entries) {
    if (item === undefined || item === null) { continue; }
    // Mobile also returns ordinary mixed-media videos; only LivePhotos belong here.
    if (item.type !== undefined && item.type !== '' && item.type !== 'livephoto') { continue; }
    const video: string = firstMediaUrl([item.video, item.videoSrc], true);
    if (video.length === 0) { continue; }
    const urls: string[] = [item.url ?? '', item.original?.url ?? '', item.largest?.url ?? '',
      item.mw2000?.url ?? '', item.large?.url ?? '', item.largecover?.url ?? '', item.bmiddle?.url ?? '', item.thumbnail?.url ?? ''];
    for (const rawUrl of urls) {
      const url: string = normalizeMediaUrl(rawUrl);
      if (url.length > 0) { result[url] = video; }
    }
  }
  return result;
}
