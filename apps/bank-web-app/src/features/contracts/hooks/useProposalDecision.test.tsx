import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useProposalDecision } from './useProposalDecision';

vi.mock('./useAcceptPayNoteDelivery', () => ({
  useAcceptPayNoteDelivery: vi.fn(),
}));

vi.mock('./useRejectPayNoteDelivery', () => ({
  useRejectPayNoteDelivery: vi.fn(),
}));

const { useAcceptPayNoteDelivery } = await import('./useAcceptPayNoteDelivery');
const { useRejectPayNoteDelivery } = await import('./useRejectPayNoteDelivery');

describe('useProposalDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls accept mutation with sessionId and handlers', () => {
    const acceptMutate = vi.fn();
    const rejectMutate = vi.fn();
    const onAccepted = vi.fn();
    const onError = vi.fn();

    vi.mocked(useAcceptPayNoteDelivery).mockReturnValue({
      mutate: acceptMutate,
      isPending: false,
    } as any);
    vi.mocked(useRejectPayNoteDelivery).mockReturnValue({
      mutate: rejectMutate,
      isPending: false,
    } as any);

    const { result } = renderHook(() =>
      useProposalDecision({
        sessionId: 'session-1',
        onAccepted,
        onError,
      })
    );

    act(() => {
      result.current.accept();
    });

    expect(acceptMutate).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );

    const acceptOptions = acceptMutate.mock.calls[0][1];
    acceptOptions.onSuccess?.();
    acceptOptions.onError?.();

    expect(onAccepted).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(rejectMutate).not.toHaveBeenCalled();
  });

  it('calls reject mutation with sessionId and handlers', () => {
    const acceptMutate = vi.fn();
    const rejectMutate = vi.fn();
    const onRejected = vi.fn();
    const onError = vi.fn();

    vi.mocked(useAcceptPayNoteDelivery).mockReturnValue({
      mutate: acceptMutate,
      isPending: false,
    } as any);
    vi.mocked(useRejectPayNoteDelivery).mockReturnValue({
      mutate: rejectMutate,
      isPending: false,
    } as any);

    const { result } = renderHook(() =>
      useProposalDecision({
        sessionId: 'session-2',
        onRejected,
        onError,
      })
    );

    act(() => {
      result.current.reject();
    });

    expect(rejectMutate).toHaveBeenCalledWith(
      { sessionId: 'session-2' },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );

    const rejectOptions = rejectMutate.mock.calls[0][1];
    rejectOptions.onSuccess?.();
    rejectOptions.onError?.();

    expect(onRejected).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
    expect(acceptMutate).not.toHaveBeenCalled();
  });

  it('aggregates pending state and blocks actions when pending', () => {
    const acceptMutate = vi.fn();
    const rejectMutate = vi.fn();

    vi.mocked(useAcceptPayNoteDelivery).mockReturnValue({
      mutate: acceptMutate,
      isPending: true,
    } as any);
    vi.mocked(useRejectPayNoteDelivery).mockReturnValue({
      mutate: rejectMutate,
      isPending: false,
    } as any);

    const { result } = renderHook(() =>
      useProposalDecision({ sessionId: 'session-3' })
    );

    expect(result.current.isPending).toBe(true);

    act(() => {
      result.current.accept();
      result.current.reject();
    });

    expect(acceptMutate).not.toHaveBeenCalled();
    expect(rejectMutate).not.toHaveBeenCalled();
  });

  it('does nothing when sessionId is missing', () => {
    const acceptMutate = vi.fn();
    const rejectMutate = vi.fn();

    vi.mocked(useAcceptPayNoteDelivery).mockReturnValue({
      mutate: acceptMutate,
      isPending: false,
    } as any);
    vi.mocked(useRejectPayNoteDelivery).mockReturnValue({
      mutate: rejectMutate,
      isPending: false,
    } as any);

    const { result } = renderHook(() =>
      useProposalDecision({ sessionId: null })
    );

    act(() => {
      result.current.accept();
      result.current.reject();
    });

    expect(acceptMutate).not.toHaveBeenCalled();
    expect(rejectMutate).not.toHaveBeenCalled();
  });
});
