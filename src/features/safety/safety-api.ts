import { supabase } from '../../lib/supabase';
import type { ReportReason } from './report-reasons';

export async function blockUser(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw error;
}

export async function reportUser(targetId: string, reason: ReportReason): Promise<void> {
  const { error } = await supabase.rpc('report_user', { p_target: targetId, p_reason: reason });
  if (error) throw error;
}
