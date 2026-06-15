// MIROIR MANUEL du schéma (migration 20260615120000). Source de vérité = `npm run db:types`
// (à régénérer depuis le cloud une fois la migration appliquée).
type Timestamptz = string;

export type Database = {
  public: {
    Tables: {
      genders: {
        Row: { id: string; key: string; label: string; is_active: boolean; sort_order: number };
        Insert: { id?: string; key: string; label: string; is_active?: boolean; sort_order?: number };
        Update: { id?: string; key?: string; label?: string; is_active?: boolean; sort_order?: number };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string; display_name: string | null; birthdate: string | null;
          gender_id: string | null; bio: string | null; location: string | null;
          created_at: Timestamptz; updated_at: Timestamptz;
        };
        Insert: {
          id: string; display_name?: string | null; birthdate?: string | null;
          gender_id?: string | null; bio?: string | null; location?: string | null;
          created_at?: Timestamptz; updated_at?: Timestamptz;
        };
        Update: {
          id?: string; display_name?: string | null; birthdate?: string | null;
          gender_id?: string | null; bio?: string | null; location?: string | null;
          created_at?: Timestamptz; updated_at?: Timestamptz;
        };
        Relationships: [];
      };
      profile_photos: {
        Row: { id: string; profile_id: string; storage_path: string; position: number; created_at: Timestamptz };
        Insert: { id?: string; profile_id: string; storage_path: string; position: number; created_at?: Timestamptz };
        Update: { id?: string; profile_id?: string; storage_path?: string; position?: number; created_at?: Timestamptz };
        Relationships: [];
      };
      preferences: {
        Row: { profile_id: string; age_min: number; age_max: number; max_distance_km: number };
        Insert: { profile_id: string; age_min: number; age_max: number; max_distance_km: number };
        Update: { profile_id?: string; age_min?: number; age_max?: number; max_distance_km?: number };
        Relationships: [];
      };
      preference_genders: {
        Row: { profile_id: string; gender_id: string };
        Insert: { profile_id: string; gender_id: string };
        Update: { profile_id?: string; gender_id?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      set_my_location: {
        Args: { lng: number; lat: number };
        Returns: undefined;
      };
      set_my_preferences: {
        Args: { p_age_min: number; p_age_max: number; p_max_distance_km: number; p_gender_ids: string[] };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
