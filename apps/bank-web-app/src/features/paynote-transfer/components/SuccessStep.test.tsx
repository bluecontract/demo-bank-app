import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { SuccessStep } from './SuccessStep';

describe('SuccessStep', () => {
  it('renders PayNote success messaging when enabled', () => {
    render(
      <SuccessStep formData={{ isPayNoteEnabled: true }} onDone={vi.fn()} />
    );

    expect(
      screen.getByText(/transfer with paynote has been authorized/i)
    ).toBeInTheDocument();
  });

  it('renders standard success messaging when PayNote is not used', () => {
    render(<SuccessStep formData={{}} onDone={vi.fn()} />);

    expect(
      screen.getByText(/transfer completed successfully/i)
    ).toBeInTheDocument();
  });
});
