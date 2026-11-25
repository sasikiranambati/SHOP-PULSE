/**
 * @file voice.ts
 * @description Frontend API client for ShopPulse Voice-to-Bill service.
 * Connects to the ShopPulse FastAPI backend voice endpoints.
 */

import { apiClient } from './client';

export interface VoiceProductCandidate {
  id: string;
  name: string;
  selling_price: number;
  current_stock: number;
  unit: string;
  category?: string;
  sku?: string;
  price_basis_quantity?: number | null;
  price_basis_unit?: string | null;
  pricing_status?: string | null;
  mrp?: number | null;
  mrp_basis_quantity?: number | null;
  mrp_basis_unit?: string | null;
}

export interface MatchedVoiceItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit: string;
  current_stock: number;
  is_out_of_stock: boolean;
  is_insufficient_stock: boolean;
  available_stock: number;
  /** Exact unit price for the sale (quantity x this, rounded to paise, equals total_price). */
  unit_price_exact?: number | null;
  /** 'spoken': the price came from the speech and must be kept; 'catalogue': the selling price. */
  price_source?: 'spoken' | 'catalogue' | 'edited';
  /** What was said when it differs from the stock quantity (e.g. "500 g" sold as 0.5 kg). */
  spoken_quantity?: string | null;
  /** Extraction command action ('add' | 'update' | 'remove'). */
  action?: 'add' | 'update' | 'remove';
  explicit_quantity?: boolean;
  match_confidence?: number | null;
  quantity_source?: 'explicit' | 'contextual_homophone' | 'stt_alternative' | 'default';
  quantity_confidence?: number | null;
  original_quantity_token?: string | null;
  raw_text?: string | null;
  package_size?: string | null;
}

export interface StructuredVoiceItem {
  raw_text: string;
  product_name: string;
  quantity: number;
  unit?: string | null;
  package_size?: string | null;
  action: 'add' | 'update' | 'remove';
  explicit_quantity: boolean;
  matched_product_id?: string | null;
  match_confidence: number;
  quantity_source?: 'explicit' | 'contextual_homophone' | 'stt_alternative' | 'default';
  quantity_confidence?: number | null;
  original_quantity_token?: string | null;
  status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'INVALID';
  reason?: string | null;
}

export interface AmbiguousVoiceItem {
  queried_name: string;
  quantity: number;
  candidates: VoiceProductCandidate[];
  /** Spoken line total, kept when a candidate is chosen. */
  spoken_price?: number | null;
  /** Ready sale line per candidate (unit converted, spoken price kept). */
  options?: MatchedVoiceItem[];
  ambiguity_type?: 'product' | 'quantity';
  suggested_quantity?: number | null;
  fallback_quantity?: number | null;
  raw_phrase?: string | null;
  reason?: string | null;
}

export interface UnmatchedVoiceItem {
  queried_name: string;
  quantity: number;
  reason: string;
}

export interface VoiceProcessRequest {
  simulation_text?: string;
  audio_base64?: string;
  audio_content_type?: string;
  language_code?: string;
  custom_products?: VoiceProductCandidate[];
  stt_confidence?: number | null;
  speech_alternatives?: string[];
}

export interface VoiceProcessResponse {
  transcript: string;
  detected_language?: string;
  provider: string;
  is_mock: boolean;
  matched_items: MatchedVoiceItem[];
  ambiguous_items: AmbiguousVoiceItem[];
  unmatched_items: UnmatchedVoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  items?: StructuredVoiceItem[];
}

export interface VoiceStatusResponse {
  voice_mode: string;
  provider: string;
  is_mock: boolean;
  sarvam_configured: boolean;
  supported_languages: Array<{
    code: string;
    name: string;
    nativeName: string;
  }>;
}

export const voiceApi = {
  /**
   * Fetch current backend voice configuration status.
   */
  getStatus: async (): Promise<VoiceStatusResponse> => {
    return apiClient.get<VoiceStatusResponse>('/api/v1/voice/status');
  },

  /**
   * Process voice input (via simulated transcript or base64 audio).
   */
  processVoiceBill: async (payload: VoiceProcessRequest): Promise<VoiceProcessResponse> => {
    return apiClient.post<VoiceProcessResponse>('/api/v1/voice/process', payload);
  },

  /**
   * Upload audio recording directly as multipart form-data.
   */
  uploadAudio: async (
    audioBlob: Blob,
    simulationText?: string,
    languageCode: string = 'en-IN'
  ): Promise<VoiceProcessResponse> => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    if (simulationText) {
      formData.append('simulation_text', simulationText);
    }
    formData.append('language_code', languageCode);

    // Call raw fetch via client baseUrl logic or proxy
    const res = await fetch('/api/v1/voice/upload-audio', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to upload voice audio');
    }

    return res.json();
  },
};
