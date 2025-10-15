import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PayNoteCodeInput } from './PayNoteCodeInput';

const hoistedPaynote = vi.hoisted(() => {
  const parsePayNoteFileMock = vi.fn();
  const encodeObjectAsPayNoteBase64Mock = vi.fn();
  return { parsePayNoteFileMock, encodeObjectAsPayNoteBase64Mock };
});

vi.mock('../../../lib/paynote', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/paynote')>(
    '../../../lib/paynote'
  );

  return {
    ...actual,
    parsePayNoteFile: hoistedPaynote.parsePayNoteFileMock,
    encodeObjectAsPayNoteBase64: hoistedPaynote.encodeObjectAsPayNoteBase64Mock,
  };
});

describe('PayNoteCodeInput', () => {
  beforeEach(() => {
    hoistedPaynote.parsePayNoteFileMock.mockReset();
    hoistedPaynote.encodeObjectAsPayNoteBase64Mock.mockReset();
  });

  it('notifies parent when the PayNote toggle is changed', () => {
    const onToggle = vi.fn();

    render(
      <PayNoteCodeInput
        enabled={false}
        value=""
        onToggle={onToggle}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/add paynote/i));

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('displays an error when the provided value is not valid base64', async () => {
    render(
      <PayNoteCodeInput
        enabled={true}
        value=""
        onToggle={vi.fn()}
        onChange={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/enter paynote code/i);
    fireEvent.change(input, { target: { value: 'invalid###' } });
    fireEvent.blur(input);

    expect(
      await screen.findByText(/invalid paynote code format/i)
    ).toBeInTheDocument();
  });

  it('parses uploaded files and emits encoded PayNote content', async () => {
    const onChange = vi.fn();
    hoistedPaynote.parsePayNoteFileMock.mockResolvedValue({
      success: true,
      data: { foo: 'bar' },
    });
    hoistedPaynote.encodeObjectAsPayNoteBase64Mock.mockReturnValue(
      'encoded-value'
    );

    render(
      <PayNoteCodeInput
        enabled={true}
        value=""
        onToggle={vi.fn()}
        onChange={onChange}
      />
    );

    const fileInput = document.getElementById(
      'payNoteFile'
    ) as HTMLInputElement;
    const file = new File(['content'], 'note.yaml', { type: 'text/yaml' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(hoistedPaynote.parsePayNoteFileMock).toHaveBeenCalledWith(file);
      expect(
        hoistedPaynote.encodeObjectAsPayNoteBase64Mock
      ).toHaveBeenCalledWith({
        foo: 'bar',
      });
      expect(onChange).toHaveBeenCalledWith('encoded-value');
    });
  });
});
