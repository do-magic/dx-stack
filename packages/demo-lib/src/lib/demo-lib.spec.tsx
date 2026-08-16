import { render } from '@testing-library/react';

import DemoLib from './demo-lib';

describe('DemoLib', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<DemoLib />);
    expect(baseElement).toBeTruthy();
  });
});
