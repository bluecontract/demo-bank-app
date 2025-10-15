import { render, screen, fireEvent } from '@testing-library/react';
import { PayNoteDetails } from './PayNoteDetails';

const toBase64 = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

describe('PayNoteDetails', () => {
  it('renders an error when the PayNote code cannot be decoded', () => {
    render(<PayNoteDetails payNoteCode="not-valid-base64" />);

    expect(
      screen.getByText(/could not parse paynote document/i)
    ).toBeInTheDocument();
  });

  it('renders summary and toggles details on demand', () => {
    render(
      <PayNoteDetails
        payNoteCode={toBase64({
          payNoteInitialStateDescription: {
            summary: 'Summary **markdown** content',
            details: 'Detailed information',
          },
        })}
      />
    );

    expect(screen.getByText(/summary/i)).toBeInTheDocument();
    expect(screen.queryByText(/detailed information/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/view details/i));
    expect(screen.getByText(/detailed information/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/hide details/i));
    expect(screen.queryByText(/detailed information/i)).not.toBeInTheDocument();
  });
});
