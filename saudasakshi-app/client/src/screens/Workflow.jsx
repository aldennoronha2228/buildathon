import { useApp } from '../state/store.jsx';
import VoiceStep from './VoiceStep.jsx';
import ConfirmStep from './ConfirmStep.jsx';
import PayStep from './PayStep.jsx';

export default function Workflow() {
  const { step } = useApp();

  return (
    <div className="flex-1 flex flex-col">
      {step === 1 && <VoiceStep key="voice" />}
      {step === 2 && <ConfirmStep key="confirm" />}
      {step === 3 && <PayStep key="pay" />}
    </div>
  );
}
