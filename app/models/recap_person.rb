# frozen_string_literal: true

class RecapPerson < ApplicationRecord
  belongs_to :player

  validates :year, presence: true, numericality: { only_integer: true }
  validates :teammate_puuid, presence: true
  validates :player_id, uniqueness: { scope: %i[year teammate_puuid] }
  validates :games, :wins_together, numericality: { greater_than_or_equal_to: 0 }
end
