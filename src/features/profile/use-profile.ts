import { useQuery } from '@tanstack/react-query';
import { fetchActiveGenders, fetchMyProfile, type MyProfileData } from './profile-api';
import { isProfileComplete } from './completeness';

export function useGenders() {
  return useQuery({ queryKey: ['genders'], queryFn: fetchActiveGenders });
}

export function useMyProfile(userId: string | undefined) {
  return useQuery<MyProfileData>({
    queryKey: ['my-profile', userId],
    queryFn: () => fetchMyProfile(userId as string),
    enabled: !!userId,
  });
}

export function useProfileCompleteness(userId: string | undefined) {
  const query = useMyProfile(userId);
  const complete = query.data
    ? isProfileComplete({
        profile: query.data.profile,
        photosCount: query.data.photos.length,
        preferences: query.data.preferences,
        seekingGenderCount: query.data.seekingGenderIds.length,
      })
    : undefined;
  return { complete, isLoading: query.isLoading, isError: query.isError };
}
