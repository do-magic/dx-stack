import { createSkaffoldInitGenerator } from '@dx-stack/skaffold';

export const initGenerator = createSkaffoldInitGenerator(
  '@dx-stack/nest-skaffold:sync',
);

export default initGenerator;
