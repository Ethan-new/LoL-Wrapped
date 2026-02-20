# frozen_string_literal: true

class RecapEnemy < ApplicationRecord
  belongs_to :player

  validates :year, presence: true, numericality: { only_integer: true }
  validates :enemy_puuid, presence: true
  validates :player_id, uniqueness: { scope: %i[year enemy_puuid] }
  validates :times_beat_us, numericality: { greater_than_or_equal_to: 0 }
end
