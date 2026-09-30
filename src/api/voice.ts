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
}

export interface AmbiguousVoiceItem {
  queried_name: string;
  quantity: number;
  candidates: VoiceProductCandidate[];
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
