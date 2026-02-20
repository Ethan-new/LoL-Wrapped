# frozen_string_literal: true

class RecapYearStat < ApplicationRecord
  belongs_to :player

  validates :year, presence: true, numericality: { only_integer: true }
  validates :player_id, uniqueness: { scope: :year }
  validates :total_pings, numericality: { greater_than_or_equal_to: 0 }
end
