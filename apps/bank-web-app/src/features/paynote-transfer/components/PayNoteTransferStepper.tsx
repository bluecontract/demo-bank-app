import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TransferFormData } from '../../../lib/paynote';
import { FormStep } from './FormStep.tsx';
import { ReviewStep } from './ReviewStep.tsx';
import { AuthorizationStep } from './AuthorizationStep.tsx';
import { SuccessStep } from './SuccessStep.tsx';

interface Account {
  accountId: string;
  accountNumber: string;
  name: string;
  currency: string;
  ledgerBalanceMinor: number;
  availableBalanceMinor: number;
  status: string;
}

interface PayNoteTransferStepperProps {
  accounts: Account[];
  defaultAccountId?: string;
}

export function PayNoteTransferStepper({
  accounts,
  defaultAccountId,
}: PayNoteTransferStepperProps) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<TransferFormData>({
    fromAccount: '',
    date: new Date().toISOString().split('T')[0],
    isPayNoteEnabled: false,
  });

  const handleFormDataChange = (updates: Partial<TransferFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    setCurrentStep((prev: number) => Math.min(prev + 1, 4));
  };

  const handleBack = () => {
    setCurrentStep((prev: number) => Math.max(prev - 1, 1));
  };

  const handleCancel = () => {
    navigate('/dashboard');
  };

  const handleSuccess = () => {
    navigate('/dashboard');
  };

  useEffect(() => {
    if (accounts?.length) {
      let fromAccount = '';
      if (defaultAccountId) {
        fromAccount =
          accounts.find(a => a.accountId == defaultAccountId)?.accountNumber ??
          '';
      } else {
        fromAccount = accounts[0].accountNumber;
      }
      setFormData(prev => ({ ...prev, fromAccount }));
    }
  }, [accounts, defaultAccountId]);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {currentStep === 1 && (
        <FormStep
          formData={formData}
          accounts={accounts}
          onFormDataChange={handleFormDataChange}
          onNext={handleNext}
          onCancel={handleCancel}
        />
      )}

      {currentStep === 2 && (
        <ReviewStep
          formData={formData}
          accounts={accounts}
          onFormDataChange={handleFormDataChange}
          onNext={handleNext}
          onBack={handleBack}
          onCancel={handleCancel}
        />
      )}

      {currentStep === 3 && (
        <AuthorizationStep
          formData={formData}
          accounts={accounts}
          onAuthorize={handleNext}
          onBack={handleBack}
          onCancel={handleCancel}
        />
      )}

      {currentStep === 4 && (
        <SuccessStep formData={formData} onDone={handleSuccess} />
      )}
    </div>
  );
}
