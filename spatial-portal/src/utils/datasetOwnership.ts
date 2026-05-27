import type { Dataset, User } from '../types';

/** True when the signed-in user may delete this dataset (not bundled VPD demos). */
export function canUserDeleteDataset(dataset: Dataset, user: User | null): boolean {
  if (!user) return false;
  if (dataset.id.startsWith('vpd-')) return false;
  return dataset.contributorId === user.id || dataset.contributorId === 'upload';
}
