import { createSkaffoldInitGenerator } from '@dx-stack/skaffold';

export const initGenerator = createSkaffoldInitGenerator(
  '@dx-stack/next-skaffold:sync',
);

export default initGenerator;
