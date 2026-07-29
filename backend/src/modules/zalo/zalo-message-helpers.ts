/**
 * zalo-message-helpers.ts — utilities for processing incoming Zalo messages.
 * Detects content type from msgType and updates contact avatars fire-and-forget.
 */
import { prisma } from '../../shared/database/prisma-client.js';

/**
 * Map zca-js msgType string to a normalized content type label.
 * Falls back to 'text' for unrecognised types or plain-string content.
 */
export function detectContentType(msgType: string | undefined, content: any): string {
  let parsedContent = content;
  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      // ignore
    }
  }

  // Tự động nhận diện ảnh nếu content chứa URL ảnh Zalo CDN (đặc biệt hữu ích khi msgType là webchat)
  if (parsedContent && typeof parsedContent === 'object') {
    const href = String(parsedContent.href || parsedContent.url || '');
    const thumb = String(parsedContent.thumb || '');
    const isZaloImage = (url: string) => 
      url.includes('zdn.vn') && 
      (url.includes('/jpg/') || url.includes('/png/') || url.includes('/webp/') || url.includes('photo-stal') || url.includes('photo.stal'));
      
    if (isZaloImage(href) || isZaloImage(thumb)) {
      return 'image';
    }
  }

  if (!msgType) return 'text';
  const msgTypeLower = msgType.toLowerCase();
  if (msgTypeLower.includes('photo') || msgTypeLower.includes('image')) return 'image';
  if (msgTypeLower.includes('sticker')) return 'sticker';
  if (msgTypeLower.includes('video')) return 'video';
  if (msgTypeLower.includes('voice')) return 'voice';
  if (msgTypeLower.includes('gif')) return 'gif';
  if (msgTypeLower.includes('link')) return 'link';
  if (msgTypeLower.includes('location')) return 'location';
  if (msgTypeLower.includes('file') || msgTypeLower.includes('doc')) return 'file';
  if (msgTypeLower.includes('recommended') || msgTypeLower.includes('card')) return 'contact_card';
  if (typeof content === 'object' && content !== null) return 'rich';
  return 'text';
}

/**
 * Fire-and-forget: fill in a missing avatarUrl on a Contact row.
 * Only updates rows where avatarUrl is currently null.
 */
export function updateContactAvatar(zaloUid: string, avatarUrl: string): void {
  prisma.contact
    .updateMany({
      where: { zaloUid, avatarUrl: null },
      data: { avatarUrl },
    })
    .catch(() => {});
}
