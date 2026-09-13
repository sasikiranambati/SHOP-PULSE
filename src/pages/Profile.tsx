import React, { useState } from 'react';
import { 
  Store, 
  User, 
  MapPin, 
  Phone, 
  RefreshCw, 
  Save, 
  CheckCircle2
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { BUSINESS_TYPE_OPTIONS } from '../data/mockData/businessTypes';
import type { StoreProfile, BusinessTypeId, PageRoute } from '../types';

interface ProfileProps {
  profile: StoreProfile;
  onUpdateProfile: (updated: Partial<StoreProfile>) => void;
  setActivePage: (page: PageRoute) => void;
}

export const Profile: React.FC<ProfileProps> = ({
  profile,
  onUpdateProfile,
  setActivePage,
}) => {
  const [shopName, setShopName] = useState(profile.shopName);
  const [ownerName, setOwnerName] = useState(profile.ownerName);
  const [location, setLocation] = useState(profile.location || 'Mumbai, MH');
  const [contact, setContact] = useState(profile.contact || '+91 98765 43210');
  const [selectedType, setSelectedType] = useState<BusinessTypeId>(profile.businessTypeId);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const activeOption = BUSINESS_TYPE_OPTIONS.find(b => b.id === selectedType) || BUSINESS_TYPE_OPTIONS[0];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateProfile({
      shopName,
      ownerName,
      location,
      contact,
      businessTypeId: selectedType,
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      
      <PageHeader
        title="Store Profile & Settings"
        description="Manage your shop details and active business type customization"
      />

      {savedSuccess && (
        <div className="p-4 bg-emerald-100 border border-emerald-300 text-emerald-900 rounded-2xl flex items-center gap-2 font-bold text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span>Store Profile & Business Type updated successfully!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        
        {/* Active Business Type Selection Card */}
        <Card className="border-2 border-emerald-300 bg-emerald-50/30">
          <div className="flex items-center justify-between pb-4 border-b border-emerald-200">
            <div className="flex items-center gap-2 font-black text-slate-900 text-lg">
              <span className="text-2xl">{activeOption.emoji}</span>
              <span>Active Business Type</span>
            </div>
            <button
              type="button"
              onClick={() => setActivePage('select-store')}
              className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1 bg-white px-3 py-1.5 rounded-lg border border-emerald-200 shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Switch Store Type
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-extrabold uppercase text-slate-500 mb-1">
                Selected Business Category
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as BusinessTypeId)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 text-base focus:ring-2 focus:ring-emerald-500"
              >
                {BUSINESS_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.emoji} {opt.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-emerald-200 flex flex-col justify-center">
              <span className="text-xs font-bold text-slate-500">Personalized Dashboard Greeting:</span>
              <span className="text-sm font-extrabold text-emerald-800 mt-0.5">
                "{activeOption.greetingWording}"
              </span>
            </div>
          </div>
        </Card>

        {/* General Shop Information Form */}
        <Card className="space-y-4">
          <h3 className="font-extrabold text-slate-900 text-lg border-b border-slate-100 pb-3 flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600" />
            <span>Store Information</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Shop Name *
              </label>
              <div className="relative">
                <Store className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Owner Name *
              </label>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Store Location / City
              </label>
              <div className="relative">
                <MapPin className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Contact Phone Number
              </label>
              <div className="relative">
                <Phone className="w-5 h-5 absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={<Save className="w-5 h-5" />}
            >
              Save Profile Changes
            </Button>
          </div>
        </Card>

      </form>
    </div>
  );
};
