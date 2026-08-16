import { createSkaffoldSyncGenerator } from '@dxs/skaffold';
import { nextJsAdapter } from '../../lib/next-adapter';

export const syncGenerator = createSkaffoldSyncGenerator([nextJsAdapter]);

export default syncGenerator;
