import React, { useState } from 'react';
import { 
  Camera, 
  Upload, 
  CheckCircle2, 
  Info
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';

export const InvoiceScanner: React.FC = () => {
  const [uploaded, setUploaded] = useState(false);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      
      <PageHeader
        title="Scan Supplier Invoice"
        description="Snap or upload paper bills to restock your inventory automatically"
      />

      <Card className="text-center p-8 sm:p-12 border-2 border-dashed border-emerald-300 bg-emerald-50/30">
        <div className="max-w-md mx-auto space-y-6">
          
          {/* Big Camera / Upload Icon Area */}
          <div className="w-24 h-24 rounded-3xl bg-emerald-600 text-white mx-auto flex items-center justify-center shadow-lg shadow-emerald-600/20">
            <Camera className="w-12 h-12" />
          </div>

          <div>
            <h2 className="text-2xl font-black text-slate-900">
              Scan Supplier Invoice
            </h2>
            <p className="text-base text-slate-600 mt-2 leading-relaxed">
              Take a photo of your supplier invoice and ShopPulse will extract the products automatically.
            </p>
          </div>

          {/* Upload Box Dropzone Simulation */}
          <div 
            onClick={() => setUploaded(true)}
            className="p-6 bg-white rounded-2xl border border-slate-300 hover:border-emerald-500 transition-all cursor-pointer shadow-xs flex flex-col items-center gap-2 group"
          >
            <Upload className="w-8 h-8 text-emerald-600 group-hover:scale-110 transition-transform" />
            <p className="text-sm font-bold text-slate-800">
              Drag & Drop invoice image or click to browse
            </p>
            <p className="text-xs text-slate-500">
              Supports PNG, JPG, or PDF supplier bills
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={() => setUploaded(true)}
              icon={<Upload className="w-5 h-5" />}
            >
              Upload Invoice
            </Button>
            
            <Button
              variant="outline"
              size="lg"
              onClick={() => setUploaded(true)}
              icon={<Camera className="w-5 h-5" />}
            >
              Open Camera
            </Button>
          </div>

          {/* Phase 0 Badge */}
          <div className="flex items-center justify-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs font-bold text-amber-900">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Phase 0 Preview — OCR bill parsing & stock extraction will be enabled in Phase 1</span>
          </div>

        </div>
      </Card>

      {/* Simulated Upload Result Modal/State */}
      {uploaded && (
        <Card className="border-2 border-emerald-400 bg-white">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-lg">
              <CheckCircle2 className="w-6 h-6" />
              <span>Sample Invoice Loaded</span>
            </div>
            <button
              onClick={() => setUploaded(false)}
              className="text-xs font-bold text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-xs text-slate-500 font-bold uppercase">Supplier</p>
              <p className="font-extrabold text-slate-900 mt-1">Mother Dairy Wholesale</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-xs text-slate-500 font-bold uppercase">Items Found</p>
              <p className="font-extrabold text-slate-900 mt-1">3 Products (50 units)</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-xs text-slate-500 font-bold uppercase">Total Bill</p>
              <p className="font-extrabold text-emerald-700 mt-1">₹1,400</p>
            </div>
          </div>

          <div className="mt-4 p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center justify-between">
            <span>Clicking "Add to Inventory" will process stock entry when backend OCR is connected.</span>
            <Button size="sm" variant="primary" onClick={() => setUploaded(false)}>
              Add to Stock
            </Button>
          </div>
        </Card>
      )}

    </div>
  );
};
