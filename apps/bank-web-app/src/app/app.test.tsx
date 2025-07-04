import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import App from './app';

describe('App', () => {
  it('should render successfully', () => {
    const { baseElement } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(baseElement).toBeTruthy();
  });

  it('should show the Demo Blue Bank title', () => {
    const { getByText } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(getByText('Demo Blue Bank')).toBeTruthy();
  });

  it('should show the system health section', () => {
    const { getByText } = render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
    expect(getByText('System Health')).toBeTruthy();
  });
});
