import { createSkaffoldSyncGenerator } from '@dx-stack/skaffold';
import { nestJsAdapter } from '../../lib/nest-adapter';

export const syncGenerator = createSkaffoldSyncGenerator([nestJsAdapter]);

export default syncGenerator;
