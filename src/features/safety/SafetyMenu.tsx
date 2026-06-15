import { useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { REPORT_REASONS, type ReportReason } from './report-reasons';
import { useBlockUser, useReportUser } from './use-safety';
import { Colors } from '../../lib/theme';

type Props = {
  targetId: string;
  onActionDone?: () => void;
  // Couleur du « ⋯ » : clair sur une photo de deck, foncé dans un en-tête blanc.
  tint?: string;
};

export function SafetyMenu({ targetId, onActionDone, tint = Colors.white }: Props) {
  const [open, setOpen] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const block = useBlockUser();
  const report = useReportUser();

  function close() {
    setOpen(false);
    setShowReasons(false);
  }

  function done() {
    close();
    onActionDone?.();
  }

  function onBlock() {
    Alert.alert('Bloquer cette personne ?', 'Elle disparaîtra et ne pourra plus te contacter.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Bloquer',
        style: 'destructive',
        onPress: () => block.mutate(targetId, { onSuccess: done }),
      },
    ]);
  }

  function onPickReason(reason: ReportReason) {
    report.mutate({ targetId, reason }, { onSuccess: done });
  }

  return (
    <>
      <Pressable accessibilityLabel="Options" hitSlop={12} onPress={() => setOpen(true)}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: tint }}>⋯</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={{ flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' }}
          onPress={close}
        >
          <Pressable
            style={{
              backgroundColor: Colors.white,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 16,
              gap: 4,
            }}
            onPress={() => {}}
          >
            {showReasons ? (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8 }}>
                  Motif du signalement
                </Text>
                {REPORT_REASONS.map((r) => (
                  <Pressable key={r.value} onPress={() => onPickReason(r.value)} style={{ paddingVertical: 12 }}>
                    <Text style={{ fontSize: 16 }}>{r.label}</Text>
                  </Pressable>
                ))}
              </>
            ) : (
              <>
                <Pressable onPress={onBlock} style={{ paddingVertical: 12 }}>
                  <Text style={{ fontSize: 16 }}>Bloquer</Text>
                </Pressable>
                <Pressable onPress={() => setShowReasons(true)} style={{ paddingVertical: 12 }}>
                  <Text style={{ fontSize: 16 }}>Signaler</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={close} style={{ paddingVertical: 12 }}>
              <Text style={{ fontSize: 16, color: Colors.textMuted }}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
