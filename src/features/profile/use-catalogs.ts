import { useQuery } from '@tanstack/react-query';
import { fetchInterests, fetchPrompts } from './catalog-api';

export function useInterests() {
  return useQuery({ queryKey: ['interests'], queryFn: fetchInterests, staleTime: 1000 * 60 * 60 });
}
export function usePrompts() {
  return useQuery({ queryKey: ['prompts'], queryFn: fetchPrompts, staleTime: 1000 * 60 * 60 });
}
