import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PayNoteCodeInput } from './PayNoteCodeInput';

const hoistedPaynote = vi.hoisted(() => {
  const parsePayNoteFileMock = vi.fn();
  const encodeObjectAsPayNoteBase64Mock = vi.fn();
  return { parsePayNoteFileMock, encodeObjectAsPayNoteBase64Mock };
});

const mockAuthState = vi.hoisted(() => ({
  user: { email: 'tester@example.com', userId: 'user-1' },
  isAuthenticated: true,
  isLoading: false,
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

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

vi.mock('../../../app/providers/AuthProvider.tsx', () => ({
  useAuth: () => mockAuthState,
}));

describe('PayNoteCodeInput', () => {
  beforeEach(() => {
    hoistedPaynote.parsePayNoteFileMock.mockReset();
    hoistedPaynote.encodeObjectAsPayNoteBase64Mock.mockReset();
    mockAuthState.user = { email: 'tester@example.com', userId: 'user-1' };
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

  it('allows loading predefined PayNotes, customizing template values, and updates the preview', async () => {
    const template = 'email: {{SHIPMENT_COMPANY_EMAIL}}\n';
    const defaultEmail = 'dhl@bluecontract.com';
    const examples = [
      {
        id: 'example',
        name: 'Example PayNote',
        description: 'Simple example for testing.',
        yaml: template,
        templateFields: [
          {
            key: 'SHIPMENT_COMPANY_EMAIL',
            label: 'Shipment Company Email',
            defaultValue: defaultEmail,
          },
        ],
        encoded: btoa(
          template.replace('{{SHIPMENT_COMPANY_EMAIL}}', defaultEmail)
        ),
      },
    ];
    const onChange = vi.fn();

    render(
      <PayNoteCodeInput
        enabled={true}
        value=""
        onToggle={vi.fn()}
        onChange={onChange}
        examples={examples}
      />
    );

    fireEvent.click(screen.getByText(/load example paynote/i));
    fireEvent.click(screen.getByRole('button', { name: /use this paynote/i }));

    const templateInput = await screen.findByLabelText(
      /shipment company email/i
    );
    expect(templateInput).toHaveValue(defaultEmail);

    const updatedEmail = 'support@shipping.test';
    fireEvent.change(templateInput, { target: { value: updatedEmail } });

    await waitFor(() => {
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(lastCall).toBeTruthy();
      expect(atob(lastCall![0])).toContain(updatedEmail);
    });

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    expect(
      await screen.findByText(`email: ${updatedEmail}`)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/close preview/i));
  });

  it('prefills template defaults with the current user email when requested', async () => {
    const template = 'contact: {{CURRENT_USER_EMAIL}}\n';
    const examples = [
      {
        id: 'user-email-example',
        name: 'Uses user email',
        description: 'Example that pulls from auth context',
        yaml: template,
        templateFields: [
          {
            key: 'CURRENT_USER_EMAIL',
            label: 'Notification Email',
            defaultValue: '{{CURRENT_USER_EMAIL}}',
          },
        ],
        encoded: btoa(template.replace('{{CURRENT_USER_EMAIL}}', '')),
      },
    ];
    mockAuthState.user = { email: 'agent@example.com', userId: 'agent-123' };

    render(
      <PayNoteCodeInput
        enabled={true}
        value=""
        onToggle={vi.fn()}
        onChange={vi.fn()}
        examples={examples}
      />
    );

    fireEvent.click(screen.getByText(/load example paynote/i));
    fireEvent.click(screen.getByRole('button', { name: /use this paynote/i }));

    const emailInput = await screen.findByLabelText(/notification email/i);
    expect(emailInput).toHaveValue('agent@example.com');
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    expect(
      await screen.findByText(/contact: agent@example.com/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/close preview/i));
  });
});
