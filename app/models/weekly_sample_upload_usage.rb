# Samples one user uploaded in one week through one channel. See WeeklySampleUploadLimit.
class WeeklySampleUploadUsage < ApplicationRecord
  belongs_to :user

  validates :channel, inclusion: { in: WeeklySampleUploadLimit::CHANNELS }
  validates :samples_count, numericality: { greater_than_or_equal_to: 0 }
end
