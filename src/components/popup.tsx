import { ReactNode } from 'react';

type PopupProps = {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

export default function Popup({ isOpen, onClose, children }: PopupProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-transparent flex items-center justify-center z-50">
      <div className="bg-neutral-100 p-6 rounded-lg shadow-2xl relative w-full max-w-sm">
        <button
          onClick={onClose}
          className="absolute top-1 right-3 text-neutral-700 hover:text-neutral-800 text-xl cursor-pointer"
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
}