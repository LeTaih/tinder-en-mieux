export const PHOTO_MAX_DIMENSION = 1080;
export const PHOTO_COMPRESS = 0.7;

export function photoStoragePath(userId: string, id: string): string {
  return `${userId}/${id}.jpg`;
}
