import { useState } from 'react';
import { Card } from '../../../ui/Card';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';

type StatusState = {
  type: 'success' | 'error' | 'info';
  message: string;
};

const DEFAULT_TOKEN = 'demo-bank-processor-token';
const DEFAULT_MERCHANT = 'Demo Shop';

const parseAmountToMinor = (value: string) => {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return Math.round(amount * 100);
};

const normalizeExpiryYear = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 100) {
    return 2000 + parsed;
  }
  return parsed;
};

const buildIdempotencyKey = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
};

export function CardSimulatorPanel() {
  const [pan, setPan] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [amount, setAmount] = useState('12.00');
  const [merchantName, setMerchantName] = useState(DEFAULT_MERCHANT);
  const [statementDescriptor, setStatementDescriptor] = useState('DEMO SHOP');
  const [categoryCode, setCategoryCode] = useState('5411');
  const [country, setCountry] = useState('US');
  const [processorChargeId, setProcessorChargeId] = useState('');
  const [processorToken, setProcessorToken] = useState(DEFAULT_TOKEN);
  const [authorizationId, setAuthorizationId] = useState('');
  const [autoCapture, setAutoCapture] = useState(true);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const baseUrl = __BANK_API_URL__ || 'http://localhost:3000';

  const runCapture = async (authId: string, amountMinor: number) => {
    const response = await fetch(
      `${baseUrl}/v1/card-processor/authorizations/${authId}/capture`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${processorToken}`,
          'idempotency-key': buildIdempotencyKey('capture'),
        },
        body: JSON.stringify({ amountMinor }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message =
        payload?.message || 'Capture failed. Check processor token and data.';
      throw new Error(message);
    }

    return response.json();
  };

  const handleAuthorize = async () => {
    setStatus(null);
    setIsSubmitting(true);

    try {
      const amountMinor = parseAmountToMinor(amount);
      if (!amountMinor) {
        throw new Error('Enter a valid amount.');
      }

      const month = Number.parseInt(expiryMonth, 10);
      const year = normalizeExpiryYear(expiryYear);
      if (!month || month < 1 || month > 12 || !year) {
        throw new Error('Enter a valid expiry date.');
      }

      const trimmedPan = pan.replace(/\s/g, '');
      if (trimmedPan.length !== 16) {
        throw new Error('Card number must be 16 digits.');
      }

      if (cvc.trim().length !== 3) {
        throw new Error('CVC must be 3 digits.');
      }

      const chargeId = processorChargeId || `ch_${Date.now()}`;

      const response = await fetch(
        `${baseUrl}/v1/card-processor/authorizations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${processorToken}`,
            'idempotency-key': buildIdempotencyKey('auth'),
          },
          body: JSON.stringify({
            pan: trimmedPan,
            expiryMonth: month,
            expiryYear: year,
            cvc: cvc.trim(),
            amountMinor,
            currency: 'USD',
            merchant: {
              name: merchantName || DEFAULT_MERCHANT,
              statementDescriptor: statementDescriptor || merchantName,
              categoryCode,
              country,
            },
            processorChargeId: chargeId,
          }),
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const message =
          payload?.message ||
          payload?.error ||
          'Authorization failed. Check the card details.';
        throw new Error(message);
      }

      const data = await response.json();

      if (data.status === 'DECLINED') {
        setStatus({
          type: 'error',
          message: data.message || 'Authorization declined by issuer.',
        });
        setAuthorizationId('');
        return;
      }

      if (data.authorizationId) {
        setAuthorizationId(data.authorizationId);
      }

      if (autoCapture && data.authorizationId) {
        await runCapture(data.authorizationId, amountMinor);
        setStatus({
          type: 'success',
          message:
            'Authorization approved and captured. Activity will update shortly.',
        });
      } else {
        setStatus({
          type: 'success',
          message:
            'Authorization approved. Use capture to post the transaction.',
        });
      }
    } catch (error) {
      setStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCapture = async () => {
    setStatus(null);
    setIsSubmitting(true);

    try {
      const amountMinor = parseAmountToMinor(amount);
      if (!amountMinor) {
        throw new Error('Enter a valid amount.');
      }

      if (!authorizationId) {
        throw new Error('Provide a hold or authorization ID to capture.');
      }

      await runCapture(authorizationId, amountMinor);
      setStatus({
        type: 'success',
        message: 'Capture sent. Transaction should post to activity feed.',
      });
    } catch (error) {
      setStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Capture failed.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Card Simulator
          </h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Create card authorizations and captures for demo activity.
          </p>
        </div>
        <span className="app-chip app-chip-neutral">Developer</span>
      </div>

      <div className="grid gap-3">
        <div>
          <label className="text-xs font-semibold text-slate-600">
            Card number
          </label>
          <Input
            value={pan}
            onChange={event => setPan(event.target.value)}
            placeholder="123456******7890"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Exp MM
            </label>
            <Input
              value={expiryMonth}
              onChange={event => setExpiryMonth(event.target.value)}
              placeholder="01"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Exp YY
            </label>
            <Input
              value={expiryYear}
              onChange={event => setExpiryYear(event.target.value)}
              placeholder="29"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">CVC</label>
            <Input
              value={cvc}
              onChange={event => setCvc(event.target.value)}
              placeholder="123"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Amount
            </label>
            <Input
              value={amount}
              onChange={event => setAmount(event.target.value)}
              placeholder="12.00"
            />
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
              For capture, amount must match the hold amount.
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Merchant
            </label>
            <Input
              value={merchantName}
              onChange={event => setMerchantName(event.target.value)}
              placeholder="Demo Shop"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="text-left text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--color-muted)]"
        onClick={() => setShowAdvanced(prev => !prev)}
      >
        {showAdvanced ? 'Hide' : 'Show'} advanced settings
      </button>

      {showAdvanced && (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">
                Statement
              </label>
              <Input
                value={statementDescriptor}
                onChange={event => setStatementDescriptor(event.target.value)}
                placeholder="DEMO SHOP"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">
                MCC
              </label>
              <Input
                value={categoryCode}
                onChange={event => setCategoryCode(event.target.value)}
                placeholder="5411"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">
                Country
              </label>
              <Input
                value={country}
                onChange={event => setCountry(event.target.value)}
                placeholder="US"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">
                Charge ID
              </label>
              <Input
                value={processorChargeId}
                onChange={event => setProcessorChargeId(event.target.value)}
                placeholder="ch_..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">
                Processor token
              </label>
              <Input
                value={processorToken}
                onChange={event => setProcessorToken(event.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={autoCapture}
          onChange={event => setAutoCapture(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[var(--color-primary)]"
        />
        Capture immediately after approval
      </label>

      {status && (
        <div
          className={`rounded-xl px-3 py-2 text-sm ${
            status.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
              : status.type === 'error'
              ? 'bg-rose-50 text-rose-700 border border-rose-100'
              : 'bg-slate-100 text-slate-700 border border-slate-200'
          }`}
        >
          {status.message}
        </div>
      )}

      <div className="space-y-3">
        <Button onClick={handleAuthorize} disabled={isSubmitting}>
          Run Authorization
        </Button>

        <div>
          <label className="text-xs font-semibold text-slate-600">
            Hold / Authorization ID
          </label>
          <Input
            value={authorizationId}
            onChange={event => setAuthorizationId(event.target.value)}
            placeholder="hold_... or UUID"
          />
          <p className="mt-1 text-xs text-[color:var(--color-muted)]">
            Paste a hold id from activity to capture it directly.
          </p>
        </div>

        <Button
          variant="secondary"
          onClick={handleCapture}
          disabled={isSubmitting}
        >
          Capture Only
        </Button>
      </div>

      <p className="text-xs text-[color:var(--color-muted)]">
        Captured charges appear in Transaction History with the merchant name
        and card last four.
      </p>
    </Card>
  );
}
