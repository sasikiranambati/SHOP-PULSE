import React, { useState } from 'react';
import { 
  Camera, 
  Upload, 
  CheckCircle2, 
  Info,
  Check
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useLanguage } from '../i18n/LanguageContext';

export const InvoiceScanner: React.FC = () => {
  const { t } = useLanguage();
  const [uploaded, setUploaded] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      
      <PageHeader
        title={t('scanner.title')}
        description={t('scanner.description')}
      />

      <Card className="text-center p-6 sm:p-10 border-2 border-dashed border-emerald-300 bg-emerald-50/20">
        <div className="max-w-md mx-auto space-y-6">
          
          {/* Big Camera Icon Area */}
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-emerald-600 text-white mx-auto flex items-center justify-center shadow-lg shadow-emerald-600/20">
            <Camera className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>

          <div>
            <h2 className="text-2xl font-black text-slate-900">
              {t('scanner.heading')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed font-semibold">
              {t('scanner.subheading')}
            </p>
          </div>

          {/* Supported Information List */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-xs text-left space-y-1.5 shadow-2xs">
            <p className="font-extrabold text-slate-900 uppercase tracking-wider mb-1">{t('scanner.supportedHeading')}</p>
            <div className="flex items-center gap-2 text-slate-700 font-bold">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t('scanner.supportedNames')}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 font-bold">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t('scanner.supportedQty')}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-700 font-bold">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t('scanner.supportedPrice')}</span>
            </div>
          </div>

          {/* Upload Box Dropzone Simulation */}
          <div 
            onClick={() => setUploaded(true)}
            className="p-6 bg-white rounded-2xl border border-slate-300 hover:border-emerald-500 transition-all cursor-pointer shadow-2xs flex flex-col items-center gap-2 group active:scale-[0.99]"
          >
            <Upload className="w-8 h-8 text-emerald-600 group-hover:scale-110 transition-transform" />
            <p className="text-sm font-extrabold text-slate-800">
              {t('scanner.dragDrop')}
            </p>
            <p className="text-xs text-slate-500 font-medium">
              {t('scanner.supportsFormat')}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => setUploaded(true)}
              icon={<Upload className="w-5 h-5" />}
              className="font-black"
            >
              {t('scanner.uploadPhoto')}
            </Button>
            
            <Button
              variant="outline"
              size="lg"
              onClick={() => setUploaded(true)}
              icon={<Camera className="w-5 h-5" />}
              className="font-black"
            >
              {t('scanner.openCamera')}
            </Button>
          </div>

          {/* Phase Notice */}
          <div className="flex items-center justify-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs font-bold text-amber-900">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('scanner.phaseNotice')}</span>
          </div>

        </div>
      </Card>

      {/* Uploaded Invoice Result Simulation */}
      {uploaded && (
        <Card className="border-2 border-emerald-400 bg-white">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-emerald-700 font-black text-base sm:text-lg">
              <CheckCircle2 className="w-6 h-6" />
              <span>{t('scanner.sampleParsed')}</span>
            </div>
            <button
              onClick={() => setUploaded(false)}
              className="text-xs font-extrabold text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              {t('scanner.clear')}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">{t('scanner.supplier')}</p>
              <p className="font-extrabold text-slate-900 mt-0.5">Mother Dairy Wholesale</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">{t('scanner.itemsExtracted')}</p>
              <p className="font-extrabold text-slate-900 mt-0.5">3 Products (50 units)</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-[11px] text-slate-500 font-bold uppercase">{t('scanner.totalAmount')}</p>
              <p className="font-black text-emerald-700 mt-0.5">₹1,400</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-900 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>Clicking "Add to Stock" will update inventory when backend OCR pipeline connects.</span>
            <Button size="sm" variant="primary" onClick={() => setUploaded(false)} className="w-full sm:w-auto font-black">
              {t('scanner.addToStock')}
            </Button>
          </div>
        </Card>
      )}

    </div>
  );
};
