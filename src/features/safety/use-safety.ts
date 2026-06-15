import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blockUser, reportUser } from './safety-api';
import type { ReportReason } from './report-reasons';

function notifyError() {
  Alert.alert('Action impossible', "L'opération n'a pas pu aboutir. Réessaie dans un instant.");
}

export function useBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) => blockUser(targetId),
    onSuccess: () => {
      // La personne bloquée disparaît du deck et des matchs (filtrage serveur).
      qc.invalidateQueries({ queryKey: ['deck'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: notifyError,
  });
}

export function useReportUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, reason }: { targetId: string; reason: ReportReason }) =>
      reportUser(targetId, reason),
    onSuccess: () => {
      // Signaler bloque aussi : mêmes invalidations.
      qc.invalidateQueries({ queryKey: ['deck'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
    onError: notifyError,
  });
}
