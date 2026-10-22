export type Language = 'de' | 'en'
export type Category = 'new' | 'plus' | 'minus'

export type Word = {
  id: string
  owner_id: string
  text: string
  language: Language
  category: Category
  consecutive_mistakes: number
  created_at: string
  last_practiced_at: string | null
}

export interface Database {
  public: {
    Tables: {
      words: {
        Row: Word
        Insert: { text: string; language: Language }
        Update: never
        Relationships: []
      }
      practice_attempts: {
        Row: {
          id: string
          owner_id: string
          word_id: string
          correct: boolean
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      record_practice: {
        Args: { p_word_id: string; p_correct: boolean; p_attempt_id: string }
        Returns: Word
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
